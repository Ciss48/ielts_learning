/**
 * Cloudflare R2 — server / CLI only.
 *
 * The bucket is private and stays private: test audio is copyrighted material.
 * Nothing is ever made public. `tests.audio_url` stores an `r2:<key>` reference,
 * never a URL, and the key is exchanged for a short-lived presigned GET URL on
 * the server at render time (`src/lib/tests.ts`). The browser therefore sees a
 * signed URL that expires, and never the bucket layout or any credential.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { config } from "@/lib/config";

/** Prefix marking an `audio_url` as a private R2 key rather than a public URL. */
export const R2_URL_PREFIX = "r2:";

/** One hour, per the phase contract. */
const PRESIGN_EXPIRY_SECONDS = 3600;

export function isR2Configured(): boolean {
  const { accountId, accessKeyId, secretAccessKey, bucket } = config.r2;
  return Boolean(accountId && accessKeyId && secretAccessKey && bucket);
}

/** The env vars that are missing, for a message the user can act on. */
export function missingR2Vars(): string[] {
  const missing: string[] = [];
  if (!config.r2.accountId) missing.push("R2_ACCOUNT_ID");
  if (!config.r2.accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!config.r2.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!config.r2.bucket) missing.push("R2_BUCKET");
  return missing;
}

function createR2Client(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      `R2 is not configured — missing ${missingR2Vars().join(", ")} in .env.local`,
    );
  }

  // R2 is S3-compatible; the region is a required field it ignores.
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
    },
  });
}

export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const client = createR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** A presigned GET URL valid for one hour. */
export async function presignR2Get(key: string): Promise<string> {
  const client = createR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.r2.bucket, Key: key }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS },
  );
}

/**
 * Resolve a stored `audio_url` for the browser.
 *
 * `r2:<key>` becomes a presigned URL; a plain `https://` value passes through
 * unchanged. A failure here returns null rather than throwing: a test whose
 * audio cannot be signed should still render its questions.
 */
export async function resolveAudioUrl(
  storedUrl: string | null,
): Promise<string | null> {
  if (storedUrl === null) return null;
  if (!storedUrl.startsWith(R2_URL_PREFIX)) return storedUrl;

  const key = storedUrl.slice(R2_URL_PREFIX.length);
  if (key === "") return null;

  if (!isR2Configured()) {
    console.error(
      `Cannot serve audio "${storedUrl}": R2 is not configured (missing ${missingR2Vars().join(", ")}).`,
    );
    return null;
  }

  try {
    return await presignR2Get(key);
  } catch (err) {
    console.error(
      `Failed to presign audio "${storedUrl}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
