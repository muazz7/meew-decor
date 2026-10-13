declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    STORE_ADMIN_EMAIL?: string;
    COMMERCE_ENABLED?: string;
    SITE_PUBLIC_URL?: string;
    BKASH_ENV?: string;
    BKASH_API_VERSION?: string;
    BKASH_USERNAME?: string;
    BKASH_PASSWORD?: string;
    BKASH_APP_KEY?: string;
    BKASH_APP_SECRET?: string;
  }
}
