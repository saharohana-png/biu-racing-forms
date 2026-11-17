declare namespace Cloudflare {
  interface Env {
    LOCAL_DEV?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
