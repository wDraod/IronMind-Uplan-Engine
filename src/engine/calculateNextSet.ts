/**
 * IronMind 核心决策引擎 — 微观层
 * 对应 prompt.md Section 3：单组诊断与推算引擎
 *
 * 执行顺序：
 *  1. 计算 VelocityLoss (3.1)
 *  2. 智能安全熔断检查 (3.4)
 *  3. 断崖式疲劳趋势检查 (3.3)
 *  4. 2×2 决策矩阵 (3.2)
 *  5. 硬件约束兜底 (3.5)
 */

import {
  SetRecord,
  ExerciseRuntimeState,
  DecisionStrategy,
  GLOBAL_CONFIG,
} from '../types';

// ---------------------------------------------------------------------------
// 公共类型
// ---------------------------------------------------------------------------

export interface NextSetSuggestion {
  load: number;
  reps: number;
  restSec: number;
  decisionStrategy: DecisionStrategy;
  aiReasoning: string;
}

// ---------------------------------------------------------------------------
// 内部决策阈值
// ---------------------------------------------------------------------------

/**
 * 决策矩阵中"高 RPE"的判定线。
 * effectiveRPE >= 8.0 → 主观疲劳感强烈。
 */
const RPE_HIGH_THRESHOLD = 8.0;

/**
 * 决策矩阵中"高 VL"的判定线（独立于硬熔断阈值）。
 * 15% 速度损失 = 动作质量开始明显下降的早期信号。
 * 硬熔断阈值（20%/35%）是更严苛的终止线，在此之前先走矩阵逻辑。
 */
const VL_HIGH_THRESHOLD = 0.15;

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 3.1 基于时间的 Velocity Loss 计算
 * VL = (lastRepDuration - firstRepDuration) / firstRepDuration
 */
export function computeVelocityLoss(
  firstRepDurationSec: number,
  lastRepDurationSec: number,
): number {
  if (firstRepDurationSec <= 0) {
    throw new RangeError(
      `firstRepDurationSec 必须 > 0，当前值: ${firstRepDurationSec}`,
    );
  }
  return (lastRepDurationSec - firstRepDurationSec) / firstRepDurationSec;
}

/**
 * 3.3 断崖式疲劳趋势检查
 * 比较当前 VL 与上一组 VL，差值 > 0.15 则触发预警。
 */
function detectFatigueCliff(
  recentVelocityLosses: number[],
  currentVL: number,
): boolean {
  if (recentVelocityLosses.length === 0) return false;
  const previousVL = recentVelocityLosses[recentVelocityLosses.length - 1];
  return currentVL - previousVL > GLOBAL_CONFIG.fatigueTrendDelta;
}

/**
 * 3.5 硬件约束兜底
 * 若计算出的重量变化量 < 最小配重片，转换为次数调整。
 */
function applyHardwareRounding(params: {
  actualLoad: number;
  actualReps: number;
  rawLoadDelta: number;
  repsDelta: number;
  strategy: DecisionStrategy;
}): { load: number; reps: number; hwRoundingApplied: boolean } {
  const { actualLoad, actualReps, rawLoadDelta, repsDelta, strategy } = params;

  // Maintain / Stop 不涉及重量变化，直接应用次数调整
  if (strategy === 'Maintain' || strategy === 'Stop') {
    return {
      load: actualLoad,
      reps: actualReps + repsDelta,
      hwRoundingApplied: false,
    };
  }

  const absLoadDelta = Math.abs(rawLoadDelta);

  // 变化量不足最小配重片 → 降级为次数调整
  if (absLoadDelta < GLOBAL_CONFIG.minPlateWeight) {
    if (strategy === 'Increase') {
      // 原计划加重 → 改为 Reps +1（prompt.md 3.5）
      return { load: actualLoad, reps: actualReps + 1, hwRoundingApplied: true };
    } else {
      // 原计划减重 → 改为 Reps -2（prompt.md 3.5）
      return { load: actualLoad, reps: actualReps - 2, hwRoundingApplied: true };
    }
  }

  // 将重量变化量对齐到最小配重片的整数倍（杠铃两侧各一片）
  const roundedDelta =
    Math.round(rawLoadDelta / GLOBAL_CONFIG.minPlateWeight) *
    GLOBAL_CONFIG.minPlateWeight;

  return {
    load: Math.max(0, actualLoad + roundedDelta),
    reps: actualReps + repsDelta,
    hwRoundingApplied: false,
  };
}

/** 按训练目标返回合理的组间休息秒数 */
function getRestSec(
  goal: SetRecord['trainingGoal'],
  intensity: 'low' | 'medium' | 'high',
): number {
  const table = {
    Strength:     { low: 240, medium: 270, high: 300 },
    Hypertrophy:  { low:  75, medium:  90, high: 120 },
  };
  return table[goal][intensity];
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

/**
 * calculateNextSet — 微观层核心决策引擎
 *
 * @param currentSet   当前已完成组的完整记录（含 RPE、耗时、实际重量/次数）
 * @param state        该动作的运行时状态（含 VL 趋势数组、当日 RPE 上限）
 * @returns            下一组的重量、次数、休息时间和语义化推理
 */
export function calculateNextSet(
  currentSet: SetRecord,
  state: ExerciseRuntimeState,
): NextSetSuggestion {
  const { actualLoad, actualReps, effectiveRPE, trainingGoal } = currentSet;
  const hardStopThreshold = GLOBAL_CONFIG.velocityLossThresholds[trainingGoal];

  // ── Step 1: 计算本组 VelocityLoss ──────────────────────────────────────
  const vl = computeVelocityLoss(
    currentSet.firstRepDurationSec,
    currentSet.lastRepDurationSec,
  );

  // ── Step 2: 智能安全熔断 (3.4) ─────────────────────────────────────────
  const hardStopTriggered = vl > hardStopThreshold;

  // ── Step 3: 断崖式疲劳趋势检查 (3.3) ──────────────────────────────────
  const cliffDetected = detectFatigueCliff(state.recentVelocityLosses, vl);

  // 熔断或断崖 → 强制终止，次数 -2，禁止加重
  if (hardStopTriggered || cliffDetected) {
    const nextReps = Math.max(1, actualReps - 2);
    const reason = hardStopTriggered
      ? `🛑 硬熔断：速度损失 ${(vl * 100).toFixed(1)}% 已超过 ${trainingGoal} 目标阈值 ` +
        `${(hardStopThreshold * 100).toFixed(0)}%。禁止加重，次数强制 -2，` +
        `建议终止本动作后充分休息。`
      : `⚠️ 断崖疲劳：本组 VL 较上组跳升超过 15%（当前 ${(vl * 100).toFixed(1)}%），` +
        `检测到神经疲劳断崖，提前终止以规避动作变形风险。`;

    return {
      load: actualLoad,
      reps: nextReps,
      restSec: getRestSec(trainingGoal, 'high'),
      decisionStrategy: 'Stop',
      aiReasoning: reason,
    };
  }

  // ── Step 4: 2×2 决策矩阵 (3.2) ─────────────────────────────────────────
  const rpeIsHigh = effectiveRPE >= RPE_HIGH_THRESHOLD;
  const vlIsHigh  = vl >= VL_HIGH_THRESHOLD;

  let rawLoadDelta: number;
  let repsDelta: number;
  let restIntensity: 'low' | 'medium' | 'high';
  let strategy: DecisionStrategy;
  let reasoning: string;

  if (rpeIsHigh && vlIsHigh) {
    // ── 场景 A：高 RPE + 高 VL → 真实力竭 ─────────────────────────────
    rawLoadDelta = actualLoad * -0.075; // -5%~-10% 取中点 -7.5%
    repsDelta    = -1;
    restIntensity = 'high';
    strategy      = 'DropLoad';
    reasoning =
      `场景A｜真实力竭：effectiveRPE ${effectiveRPE.toFixed(1)} + ` +
      `VL ${(vl * 100).toFixed(1)}%。` +
      `下调重量 7.5%，减少 1 次，保证充分恢复。`;

  } else if (rpeIsHigh && !vlIsHigh) {
    // ── 场景 B：高 RPE + 低 VL → 神经募集佳，主观疲劳 ─────────────────
    rawLoadDelta = 0;
    repsDelta    = -1;
    restIntensity = 'medium';
    strategy      = 'Maintain';
    reasoning =
      `场景B｜神经优势：effectiveRPE ${effectiveRPE.toFixed(1)} 偏高但 ` +
      `VL 仅 ${(vl * 100).toFixed(1)}%，动作质量良好。` +
      `保持重量，减 1 次，适度延长休息缓解主观疲劳。`;

  } else if (!rpeIsHigh && vlIsHigh) {
    // ── 场景 C：低 RPE + 高 VL → 代偿/虚假兴奋，高风险 ───────────────
    rawLoadDelta = 0;
    repsDelta    = 0;
    restIntensity = 'medium';
    strategy      = 'Stop';
    reasoning =
      `场景C｜⚠️ 高风险：effectiveRPE ${effectiveRPE.toFixed(1)} 低但 ` +
      `VL 已达 ${(vl * 100).toFixed(1)}%，疑似动作代偿或虚假兴奋。` +
      `锁定重量，禁止本轮加重，建议终止该动作进行评估。`;

  } else {
    // ── 场景 D：低 RPE + 低 VL → 状态极佳 ────────────────────────────
    rawLoadDelta = actualLoad * 0.025; // +2.5%
    repsDelta    = 1;
    restIntensity = 'low';
    strategy      = 'Increase';
    reasoning =
      `场景D｜超级状态：effectiveRPE ${effectiveRPE.toFixed(1)} + ` +
      `VL ${(vl * 100).toFixed(1)}%，储备充足。` +
      `尝试加重 2.5% 并追加 1 次，乘胜追击。`;
  }

  // ── Step 4b: 当日 RPE Cap 覆盖检查 ─────────────────────────────────────
  // 若已触及宏观约束上限，将 Increase 降级为 Maintain
  if (strategy === 'Increase' && effectiveRPE >= state.macroRPECap) {
    rawLoadDelta = 0;
    repsDelta    = 0;
    strategy     = 'Maintain';
    reasoning   += ` 但 effectiveRPE 已达今日上限 ${state.macroRPECap}，` +
                   `取消加重，保守执行。`;
  }

  // ── Step 5: 硬件约束兜底 (3.5) ─────────────────────────────────────────
  const { load, reps, hwRoundingApplied } = applyHardwareRounding({
    actualLoad,
    actualReps,
    rawLoadDelta,
    repsDelta,
    strategy,
  });

  if (hwRoundingApplied) {
    const direction = strategy === 'Increase' ? '+1 次' : '-2 次';
    reasoning +=
      ` [硬件兜底] 理论变化量 ${Math.abs(rawLoadDelta).toFixed(2)} kg` +
      ` 不足最小配重片 ${GLOBAL_CONFIG.minPlateWeight} kg，` +
      `转换为次数调整（${direction}）。`;
  }

  return {
    load,
    reps: Math.max(1, reps),
    restSec: getRestSec(trainingGoal, restIntensity),
    decisionStrategy: strategy,
    aiReasoning: reasoning,
  };
}
