太痛快了！经过这几次如同“手术刀”般精准的推演，我们已经把 IronMind 从一个“充满科研幻想的概念”修剪成了一个“工程可行、逻辑极度硬核”的 L2 级商业辅助引擎。

这套逻辑不仅保住了你作为 AI PM 的专业深度，也为你接下来 3 个月的单人 Vibe Coding 铺平了道路。

下面这份 **《IronMind MVP 核心工程规范与 System Prompt》** 是为你和 Claude Code 定制的最终版本。你只需**直接复制全文**，作为项目的初始 `prompt.md` 或者放在 Cursor / Claude Code 的 Context 中，它就能完全理解你要做什么，且绝不跑偏。

***

# 🏋️ IronMind MVP: 基于 VBT 与 APRE 的力量训练决策智能体 (Engineering Brief)

## 📌 0. 致 AI Coder 的项目初始化指令 (Project Context)
你当前正在协助一位独立开发者（AI PM）进行 Vibe Coding，目标是在 3 个月内构建出 IronMind 的核心 MVP 原型。
* **开发约束**：专注核心业务逻辑的闭环，优先跑通数据流与推算引擎。对于耗时的冷启动模型或庞大的日历周期系统，采用 Mock 数据替代。
* **核心范式**：本系统彻底摒弃“心率决定力量表现”的伪科学，全面转向以 **VBT (基于速度的训练)** 和 **APRE (自我调节渐进阻力)** 为核心的决策引擎。所有硬件端难以获取的绝对速度 (m/s)，统一降级为**“单次动作耗时变化 (Time-Based Velocity Loss)”**进行等效计算。

---

## 🛠️ 1. 全局配置与状态 (Global State & Config)
系统必须支持基于 `TrainingGoal` 的动态策略切换，这是避免“一刀切”降级的关键。

```typescript
type TrainingGoal = 'Strength' | 'Hypertrophy';

const GLOBAL_CONFIG = {
  minPlateWeight: 1.25, // 健身房最小配重片 (kg)
  velocityLossThresholds: {
    'Strength': 0.20,     // 力量日：速度下降 20% 即视为过度疲劳
    'Hypertrophy': 0.35   // 肌肥大日：容忍更高的代谢压力
  }
};
```

---

## 🧭 2. 宏观层：晨间边界约束引擎 (Macro Constraint Engine)
**业务目标**：通过晨间 HRV 变化，设定当日训练的“风险上限”，而非直接决定训练能力。并且需要根据 `TrainingGoal` 解决降级冲突。

* **输入**：`deltaHRV` (今日 HRV 对比 7 日基线的百分比变化), `TrainingGoal`
* **输出规则表**：

| $\Delta HRV$ 状态 | Max RPE Cap | 降级策略 (`Strength` 目标) | 降级策略 (`Hypertrophy` 目标) |
| :--- | :--- | :--- | :--- |
| **> -5% (Green)** | `RPE 10` | 正常执行 | 正常执行 |
| **-5% ~ -15% (Yellow)** | `RPE 8.5` | 砍总容量 (Volume -1 组)，保重量 | 降重量 (Load -5%)，保容量 |
| **-15% ~ -30% (Orange)**| `RPE 7.5` | 强制容量减半，锁定当前重量 | 强制降重量 10%，容量 -1 组 |
| **< -30% (Red)** | `RPE 6.0` | **熔断**：强制转为极轻度恢复 | **熔断**：强制转为极轻度恢复 |

---

## 🔬 3. 微观层：单组诊断与推算引擎 (Micro Action Engine)
这是系统的核心大脑。单组结束后触发，计算下一组的 Load (重量)、Reps (次数) 和 Rest (休息时间)。

### 3.1 核心指标计算：基于时间的 Velocity Loss
禁止进行加速度二次积分。使用首尾 Rep 的耗时差来代理速度损失：
`VelocityLoss = (LastRepDuration - FirstRepDuration) / FirstRepDuration`

### 3.2 决策矩阵 (Decision Matrix)
根据 `EffectiveRPE` 和 `VelocityLoss` (VL) 驱动。

* **场景 A (高 RPE + 高 VL)**：真实力竭。强制下调重量 (-5%~-10%) 或削减次数。
* **场景 B (高 RPE + 低 VL)**：神经募集极佳但主观疲劳。保重量，降次数，适度延长休息。
* **场景 C (低 RPE + 高 VL)**：动作变形/虚假兴奋 (危险)。**锁定重量禁止增加**，停止该组。
* **场景 D (低 RPE + 低 VL)**：状态极佳。尝试加重 (+2.5%) 或加次数。

### 3.3 趋势预警 (Fatigue Trend Tracker)
检查当前动作最近 3 组的 VL 数组。
`if (VL[current] - VL[previous] > 0.15) { 触发断崖式疲劳警告，提前终止该动作 }`

### 3.4 智能安全熔断 (Smart Hard-Stop)
`if (VelocityLoss > GLOBAL_CONFIG.velocityLossThresholds[currentGoal]) {`
   `禁止加重; 建议立即终止该组; 下一组最大预设 Reps 强制 -2;`
`}`

### 3.5 硬件约束兜底 (Hardware Rounding)
当计算出的 $\Delta Load < GLOBAL_CONFIG.minPlateWeight$ 时：
* 若原计划为加重：保持原重量，目标 Reps `+1`。
* 若原计划为减重：保持原重量，目标 Reps `-2`。

---

## 🗄️ 4. 核心数据结构约束 (Data Schema)

请在初始化项目时，严格按照以下 TypeScript 接口建立数据层或 Mock 数据。**注意：为应对冷启动问题，当前阶段统一采用 `Mocked_Veteran_LVP` (资深用户虚拟画像) 绕过机器学习计算。**

```typescript
// 1. 训练组记录 (核心推算单元)
export interface SetRecord {
  setId: string;
  exerciseId: string;
  trainingGoal: TrainingGoal;
  
  // 预设目标
  targetLoad: number;
  targetReps: number;
  
  // 练中实际采集
  actualLoad: number;
  actualReps: number;
  userRPE: number;
  effectiveRPE: number; // 经贝叶斯校准后的 RPE
  
  // VBT (Time-Based)
  firstRepDurationSec: number;
  lastRepDurationSec: number;
  velocityLossPercent: number; 
  
  // 系统计算输出
  decisionStrategy: 'DropLoad' | 'Maintain' | 'Stop' | 'Increase';
  nextSetSuggestion: {
    load: number;
    reps: number;
    restSec: number;
    aiReasoning: string; // LLM 语义化解释
  };
}

// 2. 运行时状态 (用于计算趋势)
export interface ExerciseRuntimeState {
  recentVelocityLosses: number[]; // 追踪趋势: e.g., [0.05, 0.12, 0.28]
  macroRPECap: number;            // 从晨间引擎继承
}
```

---

## 🚀 5. AI Coder 执行路线图 (Execution Plan)

收到此提示词后，请按照以下 P0 优先级顺序开始开发：

* **Step 1**：搭建基础 Typescript/Node.js (或你选定的前端框架) 环境，建立上述 Data Schema。
* **Step 2**：编写一个纯逻辑函数 `calculateNextSet(currentSet: SetRecord, state: ExerciseRuntimeState)`，实现【3. 微观层】中的完整决策矩阵、趋势预警、智能熔断与硬件兜底逻辑。
* **Step 3**：编写测试用例 (Jest/Vitest)。**必须包含以下边缘测试场景**：
    * *用户虚报 RPE*：填写 RPE 6，但测得 Velocity Loss 高达 40% (预期：触发硬熔断)。
    * *无法配重补偿*：系统算得减重 1kg，但受限于 1.25kg 最小片重，改为减次数 (预期：Load 不变，Reps -2)。
* **Step 4**：基于测试通过的核心逻辑，封装对外 API 或前端 Store 交互。