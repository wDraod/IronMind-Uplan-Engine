// ============================================================
// IronMind Core Data Schema
// Source of truth: prompt.md Section 1 & 4
// ============================================================

// --- 基础枚举 & 配置 ---

export type TrainingGoal = 'Strength' | 'Hypertrophy';

export type HRVStatus = 'Green' | 'Yellow' | 'Orange' | 'Red';

export type DecisionStrategy = 'DropLoad' | 'Maintain' | 'Stop' | 'Increase';

export const GLOBAL_CONFIG = {
  minPlateWeight: 1.25, // 健身房最小配重片 (kg)
  velocityLossThresholds: {
    Strength: 0.20,     // 力量日：速度下降 20% 触发硬熔断
    Hypertrophy: 0.35,  // 肌肥大日：容忍更高代谢压力
  },
  hrvThresholds: {
    green: -0.05,       // deltaHRV > -5%
    yellow: -0.15,      // -5% ~ -15%
    orange: -0.30,      // -15% ~ -30%
    // red: < -30%
  },
  fatigueTrendDelta: 0.15, // 断崖式疲劳预警阈值：相邻两组 VL 差值
} as const;

// --- 用户配置 (UserConfig) ---

export interface UserConfig {
  userId: string;
  name: string;
  trainingGoal: TrainingGoal;

  // 贝叶斯 RPE 校准参数 (冷启动阶段使用 Mocked_Veteran_LVP)
  rpeCalibration: {
    isMocked: true;
    profile: 'Mocked_Veteran_LVP';
    // 资深用户倾向低报 RPE，校准系数 > 1
    underreportingFactor: number; // e.g., 1.15
  } | {
    isMocked: false;
    underreportingFactor: number; // 由历史数据计算
  };
}

// --- 晨间宏观约束结果 (MacroConstraint) ---

export interface MacroConstraint {
  date: string;           // ISO date, e.g. "2026-04-07"
  deltaHRV: number;       // 今日 HRV 对比 7 日基线的百分比变化，e.g. -0.08 = -8%
  hrvStatus: HRVStatus;
  maxRPECap: number;      // e.g. 8.5
  volumeModifier: number; // 组数修正，e.g. -1 表示减一组，0 表示正常
  loadModifier: number;   // 重量修正比例，e.g. -0.05 表示 -5%，0 表示不变
  isMeltdown: boolean;    // Red 区熔断标志
}

// --- 单组记录 (SetRecord) ---

export interface SetRecord {
  setId: string;
  exerciseId: string;
  trainingGoal: TrainingGoal;

  // 预设目标
  targetLoad: number;     // kg
  targetReps: number;

  // 练中实际采集
  actualLoad: number;     // kg
  actualReps: number;
  userRPE: number;        // 用户主观上报，1-10
  effectiveRPE: number;   // 经贝叶斯校准后的 RPE

  // VBT (Time-Based Velocity Loss)
  firstRepDurationSec: number;
  lastRepDurationSec: number;
  velocityLossPercent: number; // 由引擎计算写入，e.g. 0.18 = 18%

  // 系统计算输出
  decisionStrategy: DecisionStrategy;
  nextSetSuggestion: {
    load: number;
    reps: number;
    restSec: number;
    aiReasoning: string; // 语义化解释，供 LLM 或 UI 展示
  };
}

// --- 动作运行时状态 (ExerciseRuntimeState) ---

export interface ExerciseRuntimeState {
  exerciseId: string;
  recentVelocityLosses: number[]; // 最近 3 组 VL 趋势，e.g. [0.05, 0.12, 0.28]
  macroRPECap: number;            // 从晨间引擎继承的当日 RPE 上限
  completedSets: SetRecord[];
}

// --- 日训练 Session (DailySession) ---

export interface DailySession {
  sessionId: string;
  userId: string;
  date: string;           // ISO date
  trainingGoal: TrainingGoal;
  macroConstraint: MacroConstraint;

  // 动作列表，key 为 exerciseId
  exercises: Record<string, ExerciseRuntimeState>;

  // Session 状态
  status: 'Active' | 'Completed' | 'Aborted';
  startedAt: string;      // ISO datetime
  endedAt?: string;
}
