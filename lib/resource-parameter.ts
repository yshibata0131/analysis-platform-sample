import { Target } from "../types/types";

export const getSnapshotExportBucketName = (env: Target) => {
  return `test-rds-snapshot-${env}`;
};

export const getSnapshotExportBucketArn = (env: Target) => {
  const bucketName = getSnapshotExportBucketName(env);
  return `arn:aws:s3:::${bucketName}`;
};
