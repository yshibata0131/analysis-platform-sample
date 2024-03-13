import { Construct } from "constructs";
import { IamPolicy } from "../.gen/providers/aws/iam-policy";
import { KmsAlias } from "../.gen/providers/aws/kms-alias";
import { KmsKey } from "../.gen/providers/aws/kms-key";
import { S3Bucket } from "../.gen/providers/aws/s3-bucket";
import { EXPORT_TABLE_NAMES } from "../constants";
import { Config, Target } from "../types/types";
import { EventBridge } from "./modules/event-bridge";
import { Lambda } from "./modules/lambda";
import { StepFunctions } from "./modules/step-functions";

type ExportRdsSnapshotProps = {
  env: Target;
  assumableRoleArn: string;
  snapshotExportBucket: S3Bucket;
  lambdaExecutableBucket: S3Bucket;
  context: Config;
};

export const ExportRdsSnapshot = (
  scope: Construct,
  props: ExportRdsSnapshotProps,
) => {
  const env = props.env;
  const context = props.context;

  //snapshot export用のkms
  const snapshotExportKms = new KmsKey(scope, "snapshot-export-kms", {
    description: "KMS for RDS snapshot export",
    deletionWindowInDays: 7,
    enableKeyRotation: true,
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "kms:*",
          Principal: {
            AWS: `arn:aws:iam::${context.sampleAccountId}:root`,
          },
          Resource: "*",
        },
        {
          Effect: "Allow",
          Principal: {
            AWS: props.assumableRoleArn,
          },
          Action: [
            "kms:Encrypt",
            "kms:Decrypt",
            "kms:ReEncrypt*",
            "kms:GenerateDataKey*",
            "kms:CreateGrant",
            "kms:DescribeKey",
            "kms:RetireGrant",
          ],
          Resource: "*",
        },
      ],
    }),
    tags: {
      Name: "snapshot-export-kms",
    },
  });
  new KmsAlias(scope, "snapshot-export-kms-alias", {
    name: "alias/snapshot-export-kms",
    targetKeyId: snapshotExportKms.keyId,
  });

  const lambdaName = "export-another-account-rds-snapshot-to-s3";
  const lambdaPolicy = new IamPolicy(scope, `${lambdaName}-policy`, {
    name: `${lambdaName}-policy-${env}`,
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "sts:AssumeRole",
          Resource: props.assumableRoleArn,
        },
      ],
    }),
  });
  const lambda = Lambda(scope, {
    lambdaName,
    env: env,
    lambdaExecutableBucket: props.lambdaExecutableBucket,
    policy: lambdaPolicy,
  });

  const definition = JSON.stringify({
    StartAt: "LambdaExec",
    States: {
      LambdaExec: {
        Type: "Task",
        Resource: lambda.arn,
        Parameters: {
          s3BucketName: props.snapshotExportBucket.bucket,
          s3BucketPrefix: "",
          iamRoleArn: props.assumableRoleArn,
          kmsKeyId: snapshotExportKms.arn,
          clusterIdentifier: context.clusterIdentifier,
          databaseName: context.databaseName,
          exportOnly: EXPORT_TABLE_NAMES,
        },
        End: true,
      },
    },
  });
  const stateMachineName = `${lambdaName}-state-machine-${env}`;
  const policy = new IamPolicy(scope, `${lambdaName}-lambda-exec-policy`, {
    name: `${lambdaName}-lambda-exec-policy-${env}`,
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "lambda:InvokeFunction",
          Resource: "*",
        },
      ],
    }),
  });
  const stateMachine = StepFunctions(scope, {
    env,
    lambdaName,
    definition,
    stateMachineName,
    policy,
  });

  const cron = "cron(0 17 * * ? *)";
  EventBridge(scope, {
    env,
    cron,
    lambdaName,
    stateMachine,
    stateMachineName,
  });
};
