/**
 * IronMind 决策引擎单元测试
 * 对应 prompt.md Step 3 强制测试场景 + 扩展覆盖
 */

import { describe, it, expect } from 'vitest';
import { calculateNextSet, computeVelocityLoss } from './calculateNextSet';
import { SetRecord, ExerciseRuntimeState } from '../types';

// ---------------------------------------------------------------------------
// 测试数据工厂
// ---------------------------------------------------------------------------

/**
 * 构造一个最小化合法 SetRecord，允许通过 overrides 覆盖任意字段。
 *
 * 默认场景：100kg × 5次，低 RPE(6.5)，低 VL
 *   - firstRepDurationSec=2.0, lastRepDurationSec=2.1
 *   - VL = (2.1-2.0)/2.0 = 0.05 → 5%（低 VL）
 */
function makeSet(overrides: Partial<SetRecord> = {}): SetRecord {
  return {
    setId: 'test-set-1',
    exerciseId: 'squat',
    trainingGoal: 'Strength',
    targetLoad: 100,
    targetReps: 5,
    actualLoad: 100,
    actualReps: 5,
    userRPE: 6.5,
    effectiveRPE: 6.5,
    firstRepDurationSec: 2.0,
    lastRepDurationSec: 2.1,   // VL = 5%
    velocityLossPercent: 0.05,
    decisionStrategy: 'Maintain',
    nextSetSuggestion: { load: 100, reps: 5, restSec: 240, aiReasoning: '' },
    ...overrides,
  };
}

/** 构造运行时状态，默认：无历史 VL 趋势、RPE Cap = 10（不限） */
function makeState(overrides: Partial<ExerciseRuntimeState> = {}): ExerciseRuntimeState {
  return {
    exerciseId: 'squat',
    recentVelocityLosses: [],
    macroRPECap: 10,
    completedSets: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 辅助函数：computeVelocityLoss
// ---------------------------------------------------------------------------

describe('computeVelocityLoss', () => {
  it('正常计算速度损失', () => {
    // (2.4 - 2.0) / 2.0 = 0.20
    expect(computeVelocityLoss(2.0, 2.4)).toBeCloseTo(0.20);
    // 首末耗时相同 → VL = 0
    expect(computeVelocityLoss(1.5, 1.5)).toBe(0);
    // (1.4 - 1.0) / 1.0 = 0.40
    expect(computeVelocityLoss(1.0, 1.4)).toBeCloseTo(0.40);
  });

  it('当 firstRepDurationSec <= 0 时应抛出 RangeError', () => {
    expect(() => computeVelocityLoss(0, 1.5)).toThrow(RangeError);
    expect(() => computeVelocityLoss(-1, 1.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 场景 D：基础增量（状态极佳）
// ---------------------------------------------------------------------------

describe('场景 D — 低 RPE + 低 VL：建议加重', () => {
  it('应返回 Increase 策略，load 比当前提高约 2.5%', () => {
    const set = makeSet({
      actualLoad: 100,
      actualReps: 5,
      effectiveRPE: 6.5,           // 低 RPE（< 8.0）
      firstRepDurationSec: 2.0,
      lastRepDurationSec: 2.1,     // VL = 5%（低 VL < 15%）
    });
    const state = makeState();

    const result = calculateNextSet(set, state);

    expect(result.decisionStrategy).toBe('Increase');
    expect(result.load).toBeGreaterThan(100);
    // 2.5% of 100kg = 2.5kg → 对齐最小配重片后应为 2.5kg（100+2.5=102.5）
    expect(result.load).toBeCloseTo(102.5, 1);
    expect(result.reps).toBe(6); // actualReps + 1
  });

  it('加重后若 reps 调整，最低应为 1', () => {
    const set = makeSet({ actualReps: 1, effectiveRPE: 6.0 });
    const state = makeState();
    const result = calculateNextSet(set, state);
    expect(result.reps).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Edge Case 1（文档强制场景）：用户虚报 RPE，速度损失触发硬熔断
// ---------------------------------------------------------------------------

describe('Edge Case 1 — 用户虚报 RPE：低 RPE 但 VL 40% 触发硬熔断', () => {
  /**
   * 用户自报 RPE 6（觉得很轻松）→ effectiveRPE 贝叶斯校准后仍偏低
   * 但实测 VL = 40%，远超 Strength 阈值 20%
   * 预期：引擎忽略主观 RPE，触发智能硬熔断 → Stop，reps -2
   */
  it('应触发硬熔断，返回 Stop 策略，reps 强制 -2', () => {
    const set = makeSet({
      trainingGoal: 'Strength',
      actualLoad: 100,
      actualReps: 5,
      userRPE: 6,
      effectiveRPE: 6.9,           // 即便校准后仍 < 8.0
      firstRepDurationSec: 1.0,
      lastRepDurationSec: 1.4,     // VL = (1.4-1.0)/1.0 = 40% >> 20% 阈值
    });
    const state = makeState();

    const result = calculateNextSet(set, state);

    expect(result.decisionStrategy).toBe('Stop');
    expect(result.reps).toBe(3);   // 5 - 2 = 3
    expect(result.load).toBe(100); // 禁止加重，重量不变
    expect(result.aiReasoning).toMatch(/硬熔断/);
  });

  it('Hypertrophy 目标下，相同 VL 40% 同样应触发熔断（阈值 35%）', () => {
    const set = makeSet({
      trainingGoal: 'Hypertrophy',
      actualLoad: 80,
      actualReps: 10,
      userRPE: 6,
      effectiveRPE: 6.5,
      firstRepDurationSec: 1.0,
      lastRepDurationSec: 1.4,    // VL = 40% > 35% 阈值
    });
    const state = makeState();

    const result = calculateNextSet(set, state);

    expect(result.decisionStrategy).toBe('Stop');
    expect(result.reps).toBe(8);  // 10 - 2 = 8
  });

  it('Strength 目标下，VL 恰好等于阈值 20% 时不应触发硬熔断（边界值：严格大于）', () => {
    // 高 RPE + VL=20%（等于阈值）：不触发硬熔断，走决策矩阵场景 A → DropLoad
    // 若硬熔断误用 >=，此处会返回 Stop；正确用 > 则返回 DropLoad
    const set = makeSet({
      trainingGoal: 'Strength',
      actualLoad: 100,
      actualReps: 5,
      effectiveRPE: 9.0,           // 高 RPE → 场景 A（不走场景 C）
      firstRepDurationSec: 1.0,
      lastRepDurationSec: 1.2,     // VL = (1.2-1.0)/1.0 = 20%，等于阈值
    });
    const state = makeState();

    const result = calculateNextSet(set, state);

    // 未触发硬熔断 → 场景 A → DropLoad，绝不是硬熔断 Stop
    expect(result.decisionStrategy).toBe('DropLoad');
  });
});

// ---------------------------------------------------------------------------
// Edge Case 2（文档强制场景）：硬件约束兜底
// ---------------------------------------------------------------------------

describe('Edge Case 2 — 硬件兜底：算得减重 < 1.25kg，改为 Reps -2', () => {
  /**
   * 触发场景 A（真实力竭）：高 RPE + 高 VL（未到硬熔断线）
   * actualLoad = 15kg → rawLoadDelta = 15 × -7.5% = -1.125kg < 1.25kg 最小片重
   * 预期：decisionStrategy = DropLoad，load 不变，reps = actualReps - 2
   */
  it('策略为 DropLoad，但 load 不变，reps -2', () => {
    const set = makeSet({
      trainingGoal: 'Strength',
      actualLoad: 15,              // 15 × 7.5% = 1.125kg < 1.25kg → 触发兜底
      actualReps: 5,
      effectiveRPE: 8.5,          // 高 RPE（>= 8.0）
      firstRepDurationSec: 1.0,
      lastRepDurationSec: 1.18,   // VL = 18%（高 VL >= 15%，但 < 20% 不触发硬熔断）
    });
    const state = makeState();

    const result = calculateNextSet(set, state);

    expect(result.decisionStrategy).toBe('DropLoad');
    expect(result.load).toBe(15);  // 重量不变
    expect(result.reps).toBe(3);   // 5 - 2 = 3（硬件兜底）
    expect(result.aiReasoning).toMatch(/硬件兜底/);
  });

  it('加重场景中，理论加重量 < 1.25kg → 改为 Reps +1，load 不变', () => {
    // actualLoad = 40kg → 40 × 2.5% = 1.0kg < 1.25kg
    const set = makeSet({
      actualLoad: 40,
      actualReps: 5,
      effectiveRPE: 6.0,          // 低 RPE
      firstRepDurationSec: 2.0,
      lastRepDurationSec: 2.1,    // VL = 5%（低 VL）→ 场景 D
    });
    const state = makeState();

    const result = calculateNextSet(set, state);

    expect(result.decisionStrategy).toBe('Increase');
    expect(result.load).toBe(40); // 无法加重，保持原重量
    expect(result.reps).toBe(6);  // 改为 Reps +1
    expect(result.aiReasoning).toMatch(/硬件兜底/);
  });
});

// ---------------------------------------------------------------------------
// 断崖式疲劳趋势预警
// ---------------------------------------------------------------------------

describe('趋势预警 — 断崖式 VL 跳升触发提前终止', () => {
  /**
   * 当前组 VL = 18%（未到 20% 硬熔断线）
   * 上一组 VL = 2% → 差值 16% > 15% 阈值
   * 预期：提前终止（Stop），不等待硬熔断
   */
  it('当前 VL 低于硬熔断线，但趋势跳升 > 15% 应触发断崖预警', () => {
    const set = makeSet({
      trainingGoal: 'Strength',
      actualLoad: 100,
      actualReps: 5,
      effectiveRPE: 7.0,
      firstRepDurationSec: 1.0,
      lastRepDurationSec: 1.18,   // VL = 18%（硬熔断阈值 20%，不触发）
    });
    const state = makeState({
      recentVelocityLosses: [0.02], // 上一组 VL = 2%，差值 = 16% > 15%
    });

    const result = calculateNextSet(set, state);

    expect(result.decisionStrategy).toBe('Stop');
    expect(result.aiReasoning).toMatch(/断崖疲劳/);
  });

  it('趋势跳升恰好等于 15% 时不应触发断崖预警（边界：严格大于）', () => {
    // 使用高 RPE 排除场景 C 的干扰：高 RPE + VL=18% → 场景 A → DropLoad
    // 若断崖误用 >=，会提前 Stop；正确用 > 则走场景 A → DropLoad
    const set = makeSet({
      actualLoad: 100,
      actualReps: 5,
      effectiveRPE: 9.0,          // 高 RPE → 场景 A
      firstRepDurationSec: 1.0,
      lastRepDurationSec: 1.18,   // VL = 18%
    });
    const state = makeState({
      recentVelocityLosses: [0.03], // 差值 = 0.18 - 0.03 = 0.15，不严格大于
    });

    const result = calculateNextSet(set, state);

    // 断崖未触发 → 走决策矩阵 → DropLoad，不是 Stop
    expect(result.decisionStrategy).toBe('DropLoad');
  });

  it('空的历史 VL 数组时不应触发断崖预警，低 RPE + 低 VL 应返回 Increase', () => {
    // 使用明确的场景 D 参数，排除其他 Stop 触发路径
    const set = makeSet({
      effectiveRPE: 6.0,
      firstRepDurationSec: 2.0,
      lastRepDurationSec: 2.1,    // VL = 5%（低 VL，低 RPE → 场景 D）
    });
    const state = makeState({ recentVelocityLosses: [] });

    const result = calculateNextSet(set, state);

    // 无历史趋势 → 不触发断崖 → 场景 D → Increase
    expect(result.decisionStrategy).toBe('Increase');
  });
});

// ---------------------------------------------------------------------------
// 场景 A/B/C 覆盖
// ---------------------------------------------------------------------------

describe('决策矩阵场景覆盖', () => {
  it('场景 A — 高 RPE + 高 VL：真实力竭，应下调重量', () => {
    const set = makeSet({
      actualLoad: 100,
      effectiveRPE: 9.0,
      firstRepDurationSec: 1.0,
      lastRepDurationSec: 1.18,   // VL = 18% >= 15%
    });
    const result = calculateNextSet(set, makeState());

    expect(result.decisionStrategy).toBe('DropLoad');
    expect(result.load).toBeLessThan(100);
  });

  it('场景 B — 高 RPE + 低 VL：保持重量，减 1 次', () => {
    const set = makeSet({
      actualLoad: 100,
      actualReps: 5,
      effectiveRPE: 8.5,
      firstRepDurationSec: 2.0,
      lastRepDurationSec: 2.1,    // VL = 5%（低 VL）
    });
    const result = calculateNextSet(set, makeState());

    expect(result.decisionStrategy).toBe('Maintain');
    expect(result.load).toBe(100);
    expect(result.reps).toBe(4);  // 5 - 1
  });

  it('场景 C — 低 RPE + 高 VL：危险信号，锁定重量并停止', () => {
    const set = makeSet({
      actualLoad: 100,
      actualReps: 5,
      effectiveRPE: 6.0,
      firstRepDurationSec: 1.0,
      lastRepDurationSec: 1.18,   // VL = 18%（高 VL >= 15%，但 < 20% 未触硬熔断）
    });
    const result = calculateNextSet(set, makeState());

    expect(result.decisionStrategy).toBe('Stop');
    expect(result.load).toBe(100); // 重量锁定不变
    expect(result.aiReasoning).toMatch(/代偿|危险/);
  });
});

// ---------------------------------------------------------------------------
// 宏观约束覆盖
// ---------------------------------------------------------------------------

describe('RPE Cap 覆盖 — 宏观约束优先级', () => {
  it('状态极佳（场景 D）但已触及 RPE Cap，应降级为 Maintain', () => {
    const set = makeSet({
      actualLoad: 100,
      actualReps: 5,
      effectiveRPE: 8.5,          // 已到达 macroRPECap
      firstRepDurationSec: 2.0,
      lastRepDurationSec: 2.1,    // VL = 5%
    });
    // 注意：effectiveRPE=8.5 >= RPE_HIGH_THRESHOLD=8.0 → 走场景 B，而非 D
    // 若想测试 Cap 降级，需要 effectiveRPE < 8 且 >= macroRPECap
    const set2 = makeSet({
      actualLoad: 100,
      actualReps: 5,
      effectiveRPE: 7.5,          // 低 RPE，触发场景 D
      firstRepDurationSec: 2.0,
      lastRepDurationSec: 2.1,
    });
    const state = makeState({ macroRPECap: 7.5 }); // effectiveRPE 已达上限

    const result = calculateNextSet(set2, state);

    expect(result.decisionStrategy).toBe('Maintain');
    expect(result.load).toBe(100); // 取消加重
  });
});
