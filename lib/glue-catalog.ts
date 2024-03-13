import { Construct } from "constructs";
import { AthenaWorkgroup } from "../.gen/providers/aws/athena-workgroup";
import { GlueCatalogDatabase } from "../.gen/providers/aws/glue-catalog-database";
import { IamPolicy } from "../.gen/providers/aws/iam-policy";
import { S3Bucket } from "../.gen/providers/aws/s3-bucket";
import { S3BucketPublicAccessBlock } from "../.gen/providers/aws/s3-bucket-public-access-block";
import { AWS_REGION, EXPORT_TABLE_NAMES, PROJECT_NAME } from "../constants";
import { Config, Target } from "../types/types";
import { GlueTable, GlueTableProps } from "./functions/glue-table";
import { EventBridge } from "./modules/event-bridge";
import { Lambda } from "./modules/lambda";
import { StepFunctions } from "./modules/step-functions";

interface GlueCatalogProps {
  env: Target;
  snapshotExportBucket: S3Bucket;
  lambdaExecutableBucket: S3Bucket;
  s3KmsKeyArn: string;
  context: Config;
}

export const GlueCatalog = (scope: Construct, props: GlueCatalogProps) => {
  // glue databaseだけ定義
  const glueCatalogDatabase = new GlueCatalogDatabase(
    scope,
    "glue-catalog-database",
    {
      name: "test-dwh",
    },
  );

  // location設定はバッチ処理でAthenaのクエリで設定する
  // athenaでクエリする際にRDSのテーブル名と違うと混乱しそうなので、Glueのテーブル名はRDSのテーブル名と同じにする
  const userParams: GlueTableProps = {
    tableName: "users",
    databaseName: glueCatalogDatabase.name,
    columns: [
      {
        name: "id",
        type: "bigint",
      },
    ],
  };
  GlueTable(scope, userParams);

  const postParams: GlueTableProps = {
    tableName: "posts",
    databaseName: glueCatalogDatabase.name,
    columns: [
      {
        name: "id",
        type: "bigint",
      },
    ],
  };
  GlueTable(scope, postParams);


  // Athenaクエリ結果格納バケット
  const athenaQueryResultBucket = new S3Bucket(
    scope,
    "athenaQueryResultBucket",
    {
      bucket: `${PROJECT_NAME}-athena-query-result-${props.env}`,
      forceDestroy: true,
    },
  );
  new S3BucketPublicAccessBlock(scope, "athenaQueryResultBucketPab", {
    blockPublicAcls: true,
    blockPublicPolicy: true,
    bucket: athenaQueryResultBucket.id,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });

  const outputLocation = `s3://${athenaQueryResultBucket.bucket}/output/`;
  // Athena Workgroup
  const athenaWorkgroup = new AthenaWorkgroup(scope, `test-${props.env}`, {
    // クエリ実行履歴があると削除できないので強制削除
    forceDestroy: true,
    configuration: {
      enforceWorkgroupConfiguration: true,
      publishCloudwatchMetricsEnabled: true,
      // athenanのクエリ結果を暗号化
      // kmsはマネージドのものを使用
      resultConfiguration: {
        encryptionConfiguration: {
          encryptionOption: "SSE_S3",
          kmsKeyArn: props.s3KmsKeyArn,
        },
        outputLocation,
      },
    },
    name: `test-${props.env}`,
  });

  const env = props.env;
  const lambdaName = "update-glue-catalog-tables";
  const bucketArn = props.snapshotExportBucket.arn;

  const glueBaseArn = `arn:aws:glue:${AWS_REGION}:${props.context.sampleAccountId}`;
  const catalogBaseArn = `arn:aws:athena:${AWS_REGION}:${props.context.sampleAccountId}`;
  const lambdaPolicy = new IamPolicy(scope, `${lambdaName}-policy`, {
    name: `${lambdaName}-policy-${env}`,
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
          Resource: [`${bucketArn}/*`, bucketArn],
        },
        {
          Effect: "Allow",
          Action: [
            "athena:StartQueryExecution",
            "athena:StopQueryExecution",
            "athena:GetQueryExecution",
            "athena:GetDataCatalog",
          ],
          Resource: [athenaWorkgroup.arn, `${catalogBaseArn}:datacatalog/*`],
        },
        {
          Effect: "Allow",
          Action: [
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
            "s3:ListMultipartUploadParts",
            "s3:AbortMultipartUpload",
            "s3:PutObject",
          ],
          Resource: [
            `${athenaQueryResultBucket.arn}/*`,
            athenaQueryResultBucket.arn,
          ],
        },
        {
          Effect: "Allow",
          Action: [
            "glue:CreateDatabase",
            "glue:GetDatabase",
            "glue:GetDatabases",
            "glue:UpdateDatabase",
            "glue:DeleteDatabase",
            "glue:CreateTable",
            "glue:UpdateTable",
            "glue:GetTable",
            "glue:GetTables",
            "glue:DeleteTable",
            "glue:BatchDeleteTable",
            "glue:BatchCreatePartition",
            "glue:CreatePartition",
            "glue:UpdatePartition",
            "glue:GetPartition",
            "glue:GetPartitions",
            "glue:BatchGetPartition",
            "glue:DeletePartition",
            "glue:BatchDeletePartition",
          ],
          Resource: [
            `${glueBaseArn}:catalog`,
            `${glueBaseArn}:database/*`,
            `${glueBaseArn}:table/*`,
          ],
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
          databaseName: props.context.databaseName,
          outputLocation,
          workgroupName: athenaWorkgroup.name,
          tableNames: EXPORT_TABLE_NAMES,
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

  const cron = "cron(0 20 * * ? *)";
  EventBridge(scope, {
    env,
    cron,
    lambdaName,
    stateMachine,
    stateMachineName,
  });
};
