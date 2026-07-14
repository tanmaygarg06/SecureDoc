const {
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { s3Client, BUCKET_NAME } = require("../config/s3Client");

// Every user's documents live under users/<userId>/... in the bucket.
// This keeps each user's files isolated by key-prefix, and lets the
// admin browse everyone's files simply by listing "users/".

function userRoot(userId) {
  return `users/${userId}/`;
}

// Prevents path traversal / escaping the user's own prefix
function sanitizePath(rawPath = "") {
  return rawPath
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
}

function buildKey(userId, folderPath, fileName = "") {
  const clean = sanitizePath(folderPath);
  const prefix = clean ? `${userRoot(userId)}${clean}/` : userRoot(userId);
  return fileName ? `${prefix}${fileName}` : prefix;
}

// Lists the immediate contents (files + subfolders) of a folder
async function listFolder(userId, folderPath = "") {
  const prefix = buildKey(userId, folderPath);

  const res = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      Delimiter: "/",
    })
  );

  const folders = (res.CommonPrefixes || []).map((cp) => {
    const name = cp.Prefix.slice(prefix.length, -1); // strip trailing slash
    return { type: "folder", name, key: cp.Prefix };
  });

  const files = (res.Contents || [])
    .filter((obj) => obj.Key !== prefix) // exclude the folder marker itself
    .map((obj) => ({
      type: "file",
      name: obj.Key.slice(prefix.length),
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
    }));

  return { folders, files };
}

async function uploadFile(userId, folderPath, file, uploader) {
  const key = buildKey(userId, folderPath, file.originalname);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || "application/octet-stream",
      Metadata: {
        "uploaded-by-email": uploader.email,
        "uploaded-by-name": uploader.name,
      },
    })
  );
  return key;
}

async function createFolder(userId, folderPath, folderName) {
  const clean = sanitizePath(folderName);
  if (!clean) {
    const err = new Error("Invalid folder name.");
    err.status = 400;
    throw err;
  }
  const key = `${buildKey(userId, folderPath)}${clean}/`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: "",
    })
  );
  return key;
}

// Ensures the key actually belongs to this user (defense in depth,
// on top of the IAM policy / route-level checks)
function assertOwnedKey(userId, key) {
  if (!key.startsWith(userRoot(userId))) {
    const err = new Error("You do not have access to this resource.");
    err.status = 403;
    throw err;
  }
}

async function deleteKey(userId, key) {
  assertOwnedKey(userId, key);

  if (key.endsWith("/")) {
    // Folder: delete every object under this prefix
    let continuationToken;
    do {
      const res = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: key,
          ContinuationToken: continuationToken,
        })
      );
      const objects = (res.Contents || []).map((o) => ({ Key: o.Key }));
      if (objects.length > 0) {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET_NAME,
            Delete: { Objects: objects },
          })
        );
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
  } else {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key })
    );
  }
}

// Wipes every object under a user's prefix (users/<userId>/...). Used
// when an admin removes a user, so orphaned files don't linger in S3.
async function deleteAllUserFiles(userId) {
  const prefix = userRoot(userId);
  let continuationToken;
  do {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    const objects = (res.Contents || []).map((o) => ({ Key: o.Key }));
    if (objects.length > 0) {
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET_NAME,
          Delete: { Objects: objects },
        })
      );
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
}

// NOTE: ownership/permission checks happen at the route level
// (assertOwnedKey for normal users; admins are allowed any "users/" key).
async function getPresignedUrl(key, mode = "view") {
  if (!key.startsWith("users/")) {
    const err = new Error("Invalid file reference.");
    err.status = 400;
    throw err;
  }

  const fileName = key.split("/").pop();
  const disposition =
    mode === "download" ? `attachment; filename="${fileName}"` : "inline";

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: disposition,
  });

  return getSignedUrl(s3Client, command, { expiresIn: 300 }); // 5 minutes
}

module.exports = {
  userRoot,
  listFolder,
  uploadFile,
  createFolder,
  deleteKey,
  deleteAllUserFiles,
  assertOwnedKey,
  getPresignedUrl,
};
