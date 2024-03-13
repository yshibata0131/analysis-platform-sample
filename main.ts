import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { App, S3Backend, TerraformStack } from "cdktf";
import { Construct } from "constructs";
import { S3Bucket } from "./.gen/providers/aws/s3-bucket";
import { S3BucketLifecycleConfiguration } from "./.gen/providers/aws/s3-bucket-lifecycle-configuration";
import { S3BucketPublicAccessBlock } from "./.gen/providers/aws/s3-bucket-public-access-block";
import { ASSUMABLE_ROLE_NAME, AWS_REGION, PROJECT_NAME } from "./constants";
import { ExportRdsSnapshot } from "./lib/export-rds-snapshot";
import { GlueCatalog } from "./lib/glue-catalog";
import {
  getSnapshotExportBucketArn,
  getSnapshotExportBucketName,
} from "./lib/resource-parameter";
import { Config, Target } from "./types/types";

class AnalysisPlatformStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new AwsProvider(this, "aws", {
      region: AWS_REGION,
      defaultTags: [
        {
          tags: {
            projectName: PROJECT_NAME,
          },
        },
      ],
    });

    // terraformのremote backendの設定
    const stateBucketName = `sample-terraform-bucket-${id}`;
    new S3Backend(this, {
      bucket: stateBucketName,
      key: `${PROJECT_NAME}/terraform.tfstate`,
      region: AWS_REGION,
    });

    const env = id as Target;
    const context = this.node.tryGetContext(id) as Config;
    const anotherAccountId = context.anotherAccountId;
    const bucketArn = getSnapshotExportBucketArn(env);
    const snapshotExportBucketName = getSnapshotExportBucketName(env);
    const assumableRoleArn = `arn:aws:iam::${anotherAccountId}:role/${ASSUMABLE_ROLE_NAME}`;
    // snapshot export用のs3 bucket
    const snapshotExportBucket = new S3Bucket(
      this,
      "s3-bucket-for-another-account-rds-snapshot",
      {
        bucket: snapshotExportBucketName,
        // このバケットにはすぐに復旧可能なデータしか置かれないのと、スタック削除時にエラーになってしまうため、true にする
        forceDestroy: true,
        tags: {
          Name: snapshotExportBucketName,
        },
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "Statement1",
              Effect: "Allow",
              Principal: {
                AWS: assumableRoleArn,
              },
              Action: [
                "s3:DeleteObject",
                "s3:GetObject",
                "s3:PutObject",
                "s3:ListBucket",
                "s3:GetBucketLocation",
              ],
              Resource: [`${bucketArn}/*`, bucketArn],
            },
          ],
        }),
      },
    );
    new S3BucketPublicAccessBlock(this, "another-account-rds-snapshot-bucket-pab", {
      blockPublicAcls: true,
      blockPublicPolicy: true,
      bucket: snapshotExportBucket.id,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    });
    new S3BucketLifecycleConfiguration(
      this,
      "another-account-rds-snapshot-bucket-lifecycle-rule",
      {
        bucket: snapshotExportBucket.id,
        // 二日で問題ないはずだが、何かあった時のため3日にしておく
        rule: [
          {
            id: "destroy-rule",
            status: "Enabled",
            expiration: {
              days: 3,
            },
          },
        ],
      },
    );

    // lambdaの実行ファイルを格納するs3 bucket
    const lambdaExecutableBucketName = `lambda-executable-bucket-${env}`;
    const lambdaExecutableBucket = new S3Bucket(
      this,
      "LambdaExecutableBucket",
      {
        bucket: lambdaExecutableBucketName,
        tags: {
          Name: lambdaExecutableBucketName,
        },
        // このバケットにはすぐに復旧可能なデータしか置かれないのと、スタック削除時にエラーになってしまうため、true にする
        forceDestroy: true,
      },
    );
    new S3BucketPublicAccessBlock(this, "lambda-executable-bucket-pab", {
      blockPublicAcls: true,
      blockPublicPolicy: true,
      bucket: snapshotExportBucket.id,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    });

    ExportRdsSnapshot(this, {
      env,
      assumableRoleArn,
      snapshotExportBucket,
      lambdaExecutableBucket,
      context,
    });
    GlueCatalog(this, {
      env,
      snapshotExportBucket,
      lambdaExecutableBucket,
      s3KmsKeyArn: context.s3KmsKeyArn,
      context,
    });
  }
}

const app = new App();
new AnalysisPlatformStack(app, "dev");

new AnalysisPlatformStack(app, "prod");
app.synth();
