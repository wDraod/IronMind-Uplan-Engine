/**
 * IronMind — 语义化反馈服务（Mock LLM 层）
 *
 * 基于规则与语境的模板引擎，将数值决策翻译为教练口吻的人话。
 * 未来可无缝替换为真实 LLM 调用（输入/输出接口不变）。
 *
 * 调性设定（来自 prompt.md Step 5）：
 *  - Stop（CNS 过载/代偿）：严肃、专业、具有保护性
 *  - Maintain（神经疲劳）：鼓励并指出客观真相
 *  - Increase（竞技状态）：克制的赞赏
 *  - DropLoad（真实力竭）：诚实、务实
 */

import { DecisionStrategy, TrainingGoal, GLOBAL_CONFIG } from './types';

// ---------------------------------------------------------------------------
// 公共类型
// ---------------------------------------------------------------------------

export interface FeedbackInput {
  // 本组数据
  velocityLossPercent: number;  // e.g. 0.38 = 38%
  userRPE: number;
  effectiveRPE: number;
  trainingGoal: TrainingGoal;
  actualLoad: number;
  actualReps: number;

  // 引擎决策输出
  decisionStrategy: DecisionStrategy;
  nextLoad: number;
  nextReps: number;
  restSec: number;

  // 上下文（用于模板变体选择）
  setNumber: number;            // 该动作的第几组（1-indexed）
}

// ---------------------------------------------------------------------------
// 内部常量
// ---------------------------------------------------------------------------

const RPE_HIGH = 8.0;
const VL_HIGH  = 0.15;

// ---------------------------------------------------------------------------
// 模板引擎
// ---------------------------------------------------------------------------

/**
 * 从多个变体中按组号轮换选取，避免重复感。
 */
function pick<T>(setNumber: number, variants: T[]): T {
  return variants[setNumber % variants.length];
}

function fmtVL(vl: number): string {
  return `${(vl * 100).toFixed(0)}%`;
}

function fmtRestMin(restSec: number): string {
  if (restSec < 60) return `${restSec} 秒`;
  const m = Math.floor(restSec / 60);
  const s = restSec % 60;
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

// ── 场景 Stop ─────────────────────────────────────────────────────────────

function generateStop(input: FeedbackInput): string {
  const { velocityLossPercent, effectiveRPE, trainingGoal, nextReps, restSec, setNumber } = input;
  const threshold = GLOBAL_CONFIG.velocityLossThresholds[trainingGoal];
  const isHardStop = velocityLossPercent > threshold;
  const isSceneC   = !isHardStop && effectiveRPE < RPE_HIGH && velocityLossPercent >= VL_HIGH;

  if (isHardStop) {
    // 硬熔断：CNS 过载，数字直接说话
    return pick(setNumber, [
      `你的动作速度下降已达 ${fmtVL(velocityLossPercent)}，` +
      `远超 ${trainingGoal} 目标的安全阈值 ${fmtVL(threshold)}。` +
      `中枢神经（CNS）正在发出过载预警。` +
      `系统已强制锁定重量，下组减少 2 次（→ ${nextReps} 次），` +
      `请严格执行，并休息 ${fmtRestMin(restSec)}。继续硬撑只会增加受伤风险。`,

      `速度损失 ${fmtVL(velocityLossPercent)}——这不是"感觉累"，是 CNS 的客观崩溃信号。` +
      `${trainingGoal === 'Strength' ? '力量训练对神经系统要求极高，' : ''}` +
      `超过 ${fmtVL(threshold)} 的速度损失意味着动作质量已无法保证安全。` +
      `硬熔断已触发：重量锁定，下组 ${nextReps} 次，` +
      `休息 ${fmtRestMin(restSec)} 后再评估是否继续。`,
    ]);
  }

  if (isSceneC) {
    // 场景 C：低 RPE 但速度损失高——最危险的欺骗状态
    return pick(setNumber, [
      `注意：你的主观感觉（RPE ${effectiveRPE.toFixed(1)}）和客观数据（速度损失 ${fmtVL(velocityLossPercent)}）` +
      `出现了严重背离。这是典型的"虚假兴奋"或动作代偿信号——身体在借助错误发力模式完成动作。` +
      `继续加重极易导致关节损伤。系统已锁定重量，建议终止该动作，` +
      `下组若继续请严格控制动作质量。`,

      `数据在对你说谎，但不是你在骗自己——你真的感觉不重，` +
      `但速度传感器检测到 ${fmtVL(velocityLossPercent)} 的损失，` +
      `说明你的主动肌已经在用代偿肌群"帮忙"了。` +
      `这是受伤前的经典信号。重量已锁定，下组减少至 ${nextReps} 次，` +
      `聚焦在主动肌的感受而非重量数字。`,
    ]);
  }

  // 断崖式疲劳趋势（cliff detected）
  return pick(setNumber, [
    `速度趋势出现断崖：本组速度损失 ${fmtVL(velocityLossPercent)}，` +
    `较上组跳升超过 15%。这是神经疲劳累积的典型曲线，` +
    `继续会让每一组的质量急剧下滑。系统提前介入，` +
    `下组减少 2 次（→ ${nextReps} 次），` +
    `休息 ${fmtRestMin(restSec)} 让神经系统做短暂恢复。`,

    `检测到速度断崖。尽管单组速度损失（${fmtVL(velocityLossPercent)}）` +
    `尚未触及硬熔断线，但趋势已不可持续。` +
    `优秀的训练者知道何时踩刹车——现在就是。` +
    `下组 ${nextReps} 次，专注技术，不要和数字较劲。`,
  ]);
}

// ── 场景 Maintain ─────────────────────────────────────────────────────────

function generateMaintain(input: FeedbackInput): string {
  const { velocityLossPercent, userRPE, effectiveRPE, nextLoad, nextReps, restSec, setNumber } = input;

  return pick(setNumber, [
    `虽然你感觉很重（RPE ${userRPE}），` +
    `但客观速度数据只损失了 ${fmtVL(velocityLossPercent)}——` +
    `你的神经募集依然出色。` +
    `不要被主观疲劳感欺骗，身体比你以为的更有储备。` +
    `保持 ${nextLoad} kg，下组 ${nextReps} 次，` +
    `休息 ${fmtRestMin(restSec)} 后稳住！`,

    `effectiveRPE 达到了 ${effectiveRPE.toFixed(1)}，说明心理疲劳在累积，` +
    `但速度损失仅 ${fmtVL(velocityLossPercent)}，动作质量完全在掌控之中。` +
    `这是心理在喊停，而不是身体。保持重量 ${nextLoad} kg，` +
    `缩减至 ${nextReps} 次，${fmtRestMin(restSec)} 后再战。`,

    `速度 vs 感觉的博弈：你感觉 RPE ${userRPE}，` +
    `但速度只掉了 ${fmtVL(velocityLossPercent)}。` +
    `神经系统的表现告诉我们——你今天的募集效率很高。` +
    `信任数据，不信情绪。${nextLoad} kg × ${nextReps} 次，` +
    `休息 ${fmtRestMin(restSec)}，继续。`,
  ]);
}

// ── 场景 Increase ─────────────────────────────────────────────────────────

function generateIncrease(input: FeedbackInput): string {
  const { velocityLossPercent, effectiveRPE, nextLoad, nextReps, setNumber } = input;

  return pick(setNumber, [
    `状态绝佳。速度损失仅 ${fmtVL(velocityLossPercent)}，` +
    `储备充足，是时候突破舒适区了。` +
    `下一组加重至 ${nextLoad} kg，${nextReps} 次，别想太多，直接上。`,

    `${fmtVL(velocityLossPercent)} 的速度损失——几乎感知不到疲劳。` +
    `RPE ${effectiveRPE.toFixed(1)} 也印证了你的储备。` +
    `${nextLoad} kg × ${nextReps} 次，乘势而上。`,

    `今天的状态在上面。速度、感觉、数据全部对齐。` +
    `${nextLoad} kg，${nextReps} 次。执行就好，不要犹豫。`,
  ]);
}

// ── 场景 DropLoad ─────────────────────────────────────────────────────────

function generateDropLoad(input: FeedbackInput): string {
  const { velocityLossPercent, effectiveRPE, nextLoad, nextReps, restSec, setNumber } = input;

  return pick(setNumber, [
    `高 RPE（${effectiveRPE.toFixed(1)}）叠加速度损失 ${fmtVL(velocityLossPercent)}，` +
    `确认真实力竭。这不是软弱，是生理极限的客观信号。` +
    `下调至 ${nextLoad} kg，${nextReps} 次，` +
    `${fmtRestMin(restSec)} 的充分休息比硬撑更有价值。`,

    `你已经给出了这组应有的一切，速度和 RPE 都到了边界。` +
    `聪明的做法是顺应信号：${nextLoad} kg，${nextReps} 次。` +
    `休息 ${fmtRestMin(restSec)}，让肌纤维充分恢复，下组才能有质量。`,

    `力竭不是失败，是超负荷的证明。` +
    `速度损失 ${fmtVL(velocityLossPercent)} + RPE ${effectiveRPE.toFixed(1)} 说明今天这块肌肉已经被充分动员。` +
    `减重至 ${nextLoad} kg，${nextReps} 次，高质量完成比高重量更重要。`,
  ]);
}

// ---------------------------------------------------------------------------
// 主服务类
// ---------------------------------------------------------------------------

export class SemanticFeedbackService {
  /**
   * 根据本组数据和引擎决策生成教练口吻的语义化建议。
   * 接口设计为无状态，可安全复用同一实例。
   */
  generate(input: FeedbackInput): string {
    switch (input.decisionStrategy) {
      case 'Stop':       return generateStop(input);
      case 'Maintain':   return generateMaintain(input);
      case 'Increase':   return generateIncrease(input);
      case 'DropLoad':   return generateDropLoad(input);
    }
  }
}
