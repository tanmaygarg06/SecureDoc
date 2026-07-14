const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { s3Client, BUCKET_NAME } = require("../config/s3Client");

// Users are stored as individual JSON objects in S3 at:
//   _system/users/<sanitized-email>.json
// This avoids needing a separate database - S3 is the only data store,
// and access to it is controlled purely through the IAM policy attached
// to the backend's IAM user/role.

const USERS_PREFIX = "_system/users/";

function emailToKey(email) {
  const safe = email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, "");
  return `${USERS_PREFIX}${encodeURIComponent(safe)}.json`;
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function getUserByEmail(email) {
  const key = emailToKey(email);
  try {
    const res = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key })
    );
    const body = await streamToString(res.Body);
    return JSON.parse(body);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

async function createUser({ name, email, password, role }) {
  const existing = await getUserByEmail(email);
  if (existing) {
    const err = new Error("An account with this email already exists.");
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = {
    id: uuidv4(),
    name,
    email: email.trim().toLowerCase(),
    passwordHash,
    role: role || "user", // 'user' | 'admin'
    createdAt: new Date().toISOString(),
  };

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: emailToKey(user.email),
      Body: JSON.stringify(user, null, 2),
      ContentType: "application/json",
    })
  );

  return user;
}

// Internal: lists every user record together with the S3 key it's
// stored under, so callers that need to mutate/delete a specific
// record (e.g. deleteUser) don't have to re-derive the key.
async function listAllUserRecords() {
  const records = [];
  let continuationToken = undefined;

  do {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: USERS_PREFIX,
        ContinuationToken: continuationToken,
      })
    );

    const objects = res.Contents || [];
    for (const obj of objects) {
      const getRes = await s3Client.send(
        new GetObjectCommand({ Bucket: BUCKET_NAME, Key: obj.Key })
      );
      const body = await streamToString(getRes.Body);
      const user = JSON.parse(body);
      records.push({ key: obj.Key, user });
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return records;
}

async function listAllUsers() {
  const records = await listAllUserRecords();
  return records.map((r) => sanitizeUser(r.user));
}

// Users are looked up everywhere else (auth, browsing) either by email
// or by the opaque uuid handed out at signup. There's no id->key index
// since S3 is keyed by email, so finding a user by id means scanning
// the (typically small) user list. Fine for admin actions, which are
// infrequent and not on any hot path.
async function getUserById(id) {
  const records = await listAllUserRecords();
  const match = records.find((r) => r.user.id === id);
  return match || null;
}

async function deleteUser(id) {
  const match = await getUserById(id);
  if (!match) {
    const err = new Error("User not found.");
    err.status = 404;
    throw err;
  }

  await s3Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: match.key })
  );

  return sanitizeUser(match.user);
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.passwordHash);
}

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  listAllUsers,
  deleteUser,
  sanitizeUser,
  verifyPassword,
};
