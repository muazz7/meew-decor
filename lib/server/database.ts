/** The SQL surface used by commerce. Both D1 and libSQL implement this contract. */
export interface StoreResult<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  meta: { changes: number; last_row_id?: number };
}

export interface StoreStatement {
  bind(...values: unknown[]): StoreStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<StoreResult<T>>;
  run<T = Record<string, unknown>>(): Promise<StoreResult<T>>;
}

export interface StoreDatabase {
  prepare(sql: string): StoreStatement;
  /** Execute in order in one write transaction; any failure rolls back every statement. */
  batch<T = Record<string, unknown>>(statements: StoreStatement[]): Promise<StoreResult<T>[]>;
}

export interface PlatformEnvironment {
  DB?: StoreDatabase;
  STORE_ADMIN_EMAIL?: string;
  STORE_ADMIN_PASSWORD_HASH?: string;
  STORE_SESSION_SECRET?: string;
  COMMERCE_ENABLED?: string;
  SITE_PUBLIC_URL?: string;
  BKASH_ENV?: string;
  BKASH_API_VERSION?: string;
  BKASH_USERNAME?: string;
  BKASH_PASSWORD?: string;
  BKASH_APP_KEY?: string;
  BKASH_APP_SECRET?: string;
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  VERCEL?: string;
}
