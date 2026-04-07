/**
 * IronMind — 训练 Session 服务层
 * 对应 prompt.md Step 4：封装对外 API
 *
 * 职责：
 *  - 接收 UserConfig 和晨间 MacroConstraint，持有当日训练上下文
 *  - 按 exerciseId 自动初始化并维护各动作的 ExerciseRuntimeState
 *  - 暴露 submitSet() 接口：调用核心引擎并自动刷新趋势状态
 */

import {
  UserConfig,
  MacroConstraint,
  SetRecord,
  ExerciseRuntimeState,
  GLOBAL_CONFIG,
} from './types';

import {
  calculateNextSet,
  computeVelocityLoss,
  NextSetSuggestion,
} from './engine/calculateNextSet';

// ---------------------------------------------------------------------------
// 公共类型
// ---------------------------------------------------------------------------

/** submitSet() 的输入参数 */
export interface SubmitSetInput {
  /** 本组计划目标重量（可选，默认与 actualLoad 相同） */
  targetLoad?: number;
  /** 本组计划目标次数（可选，默认与 actualReps 相同） */
  targetReps?: number;
  /** 实际完成重量 (kg) */
  actualLoad: number;
  /** 实际完成次数 */
  actualReps: number;
  /** 用户主观上报 RPE（1–10） */
  userRPE: number;
  /** 首次动作耗时（秒） */
  firstRepDurationSec: number;
  /** 末次动作耗时（秒） */
  lastRepDurationSec: number;
}

/** submitSet() 的返回结果 */
export interface SubmitSetResult {
  /** 本组的完整 SetRecord（含系统计算输出），可直接持久化 */
  setRecord: SetRecord;
  /** 下一组建议，供 UI 展示 */
  suggestion: NextSetSuggestion;
  /** 当日宏观熔断警告（Red 区时为 true） */
  meltdownWarning: boolean;
}

/** 当前 Session 快照（供前端全量同步用） */
export interface SessionSnapshot {
  userId: string;
  date: string;
  trainingGoal: UserConfig['trainingGoal'];
  macroConstraint: MacroConstraint;
  exercises: Record<string, ExerciseRuntimeState>;
}

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

export class WorkoutSessionService {
  private readonly config: UserConfig;
  private readonly macro: MacroConstraint;

  /** 按 exerciseId 分组的运行时状态 */
  private readonly exercises = new Map<string, ExerciseRuntimeState>();

  /** 自增 set 计数器，用于生成 setId */
  private setCounter = 0;

  constructor(config: UserConfig, macro: MacroConstraint) {
    this.config = config;
    this.macro = macro;
  }

  // ── 核心接口 ──────────────────────────────────────────────────────────────

  /**
   * 提交一组训练数据，返回引擎的下一组建议。
   *
   * @param exerciseId  动作标识，如 'squat' / 'bench_press'
   * @param input       本组的实际采集数据
   */
  submitSet(exerciseId: string, input: SubmitSetInput): SubmitSetResult {
    // 1. 自动初始化该动作的运行时状态
    const state = this.getOrInitState(exerciseId);

    // 2. 计算 Velocity Loss（3.1）
    const vl = computeVelocityLoss(
      input.firstRepDurationSec,
      input.lastRepDurationSec,
    );

    // 3. 贝叶斯 RPE 校准（冷启动阶段 Mocked_Veteran_LVP）
    const effectiveRPE = Math.min(
      input.userRPE * this.config.rpeCalibration.underreportingFactor,
      10,
    );

    // 4. 构建 SetRecord（输出字段先用占位值，引擎调用后回填）
    this.setCounter += 1;
    const partialSet: SetRecord = {
      setId: `${exerciseId}-set-${this.setCounter}`,
      exerciseId,
      trainingGoal: this.config.trainingGoal,
      targetLoad: input.targetLoad ?? input.actualLoad,
      targetReps: input.targetReps ?? input.actualReps,
      actualLoad: input.actualLoad,
      actualReps: input.actualReps,
      userRPE: input.userRPE,
      effectiveRPE,
      firstRepDurationSec: input.firstRepDurationSec,
      lastRepDurationSec: input.lastRepDurationSec,
      velocityLossPercent: vl,
      // 占位值，将在引擎返回后回填
      decisionStrategy: 'Maintain',
      nextSetSuggestion: { load: 0, reps: 0, restSec: 0, aiReasoning: '' },
    };

    // 5. 调用核心决策引擎
    const suggestion = calculateNextSet(partialSet, state);

    // 6. 用引擎结果回填，得到完整 SetRecord
    const completedSet: SetRecord = {
      ...partialSet,
      decisionStrategy: suggestion.decisionStrategy,
      nextSetSuggestion: {
        load: suggestion.load,
        reps: suggestion.reps,
        restSec: suggestion.restSec,
        aiReasoning: suggestion.aiReasoning,
      },
    };

    // 7. 刷新运行时状态
    //    recentVelocityLosses 保留最近 3 组（趋势预警窗口）
    state.recentVelocityLosses = [
      ...state.recentVelocityLosses,
      vl,
    ].slice(-3);
    state.completedSets.push(completedSet);

    return {
      setRecord: completedSet,
      suggestion,
      meltdownWarning: this.macro.isMeltdown,
    };
  }

  // ── 查询接口 ──────────────────────────────────────────────────────────────

  /** 查询某动作的当前运行时状态 */
  getExerciseState(exerciseId: string): ExerciseRuntimeState | undefined {
    return this.exercises.get(exerciseId);
  }

  /** 获取整个 Session 的快照（供前端全量同步或持久化） */
  getSessionSnapshot(): SessionSnapshot {
    const exercises: Record<string, ExerciseRuntimeState> = {};
    this.exercises.forEach((state, id) => {
      exercises[id] = state;
    });
    return {
      userId: this.config.userId,
      date: this.macro.date,
      trainingGoal: this.config.trainingGoal,
      macroConstraint: this.macro,
      exercises,
    };
  }

  // ── 内部工具 ──────────────────────────────────────────────────────────────

  private getOrInitState(exerciseId: string): ExerciseRuntimeState {
    if (!this.exercises.has(exerciseId)) {
      this.exercises.set(exerciseId, {
        exerciseId,
        recentVelocityLosses: [],
        macroRPECap: this.macro.maxRPECap,
        completedSets: [],
      });
    }
    return this.exercises.get(exerciseId)!;
  }
}
