const { S3Client } = require("@aws-sdk/client-s3");

// The S3 client authenticates using the IAM user's access key / secret key.
// These credentials are scoped down to ONLY this bucket via the IAM policy
// described in the README (least-privilege principle).
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

module.exports = { s3Client, BUCKET_NAME };
