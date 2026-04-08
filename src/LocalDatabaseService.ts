/**
 * IronMind — 本地文件数据库服务
 *
 * 使用 fs.promises 将训练数据持久化到 data/mock_db.json。
 * 接口与真实数据库服务保持一致，未来可无缝替换为 SQLite / Supabase 等。
 */

import fs from 'fs/promises';
import path from 'path';
import { DailySession } from './types';

// ---------------------------------------------------------------------------
// DB Schema
// ---------------------------------------------------------------------------

interface DbSchema {
  sessions: DailySession[];
}

const EMPTY_DB: DbSchema = { sessions: [] };

// ---------------------------------------------------------------------------
// 服务类
// ---------------------------------------------------------------------------

export class LocalDatabaseService {
  private readonly filePath: string;

  /**
   * @param filePath 数据文件绝对路径，默认为项目根目录下的 data/mock_db.json
   */
  constructor(filePath?: string) {
    this.filePath = filePath ?? path.resolve(process.cwd(), 'data', 'mock_db.json');
  }

  // ── 写入 ────────────────────────────────────────────────────────────────────

  /**
   * 保存或更新一条 DailySession 记录（按 sessionId upsert）。
   * 若同一 sessionId 已存在则覆盖，否则追加。
   */
  async saveSession(session: DailySession): Promise<void> {
    const db = await this.readDb();

    const idx = db.sessions.findIndex(s => s.sessionId === session.sessionId);
    if (idx >= 0) {
      db.sessions[idx] = session;          // 覆盖（重复调用安全）
    } else {
      db.sessions.push(session);           // 追加
    }

    await this.writeDb(db);
  }

  // ── 读取 ────────────────────────────────────────────────────────────────────

  /**
   * 返回指定用户的全部历史 Session，按日期升序排列。
   */
  async getUserHistory(userId: string): Promise<DailySession[]> {
    const db = await this.readDb();
    return db.sessions
      .filter(s => s.userId === userId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * 返回数据库中所有 Session 的数量（用于调试/验证）。
   */
  async getTotalCount(): Promise<number> {
    const db = await this.readDb();
    return db.sessions.length;
  }

  // ── 内部 I/O ────────────────────────────────────────────────────────────────

  private async readDb(): Promise<DbSchema> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as DbSchema;
    } catch (err: unknown) {
      // 文件不存在时从空库开始，其他错误继续抛出
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...EMPTY_DB, sessions: [] };
      }
      throw err;
    }
  }

  private async writeDb(db: DbSchema): Promise<void> {
    // 确保目录存在
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(db, null, 2), 'utf-8');
  }
}
