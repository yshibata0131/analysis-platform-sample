import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { App, TerraformStack } from "cdktf";
import { Construct } from "constructs";
import { ASSUMABLE_ROLE_NAME, AWS_REGION, PROJECT_NAME } from "../constants";
import { getSnapshotExportBucketArn } from "../lib/resource-parameter";
import { Target } from "../types/types";
import { Config } from "../types/types";
import { IamPolicy } from "./.gen/providers/aws/iam-policy";
import { IamRole } from "./.gen/providers/aws/iam-role";

class MyStack extends TerraformStack {
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

    const env = id as Target;
    const context = this.node.tryGetContext(id) as Omit<Config, "databaseName">;
    const sampleAccountId = context.sampleAccountId;
    const anotherAccountId = context.anotherAccountId;
    const rolePolicy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "allowAssumeRoleFromSnapshotExportLambda",
          Effect: "Allow",
          Action: "sts:AssumeRole",
          Principal: {
            AWS: `arn:aws:iam::${sampleAccountId}:role/export-another-account-rds-snapshot-to-s3-lambda-exec-role-${env}`,
          },
        },
        {
          Sid: "allowAssumeRoleFromExportRds",
          Effect: "Allow",
          Action: "sts:AssumeRole",
          Principal: {
            Service: "export.rds.amazonaws.com",
          },
        },
      ],
    };

    // Create role for assume role from sample lambda
    const roleName = ASSUMABLE_ROLE_NAME;
    const bucketArn = getSnapshotExportBucketArn(env);
    new IamRole(this, roleName, {
      name: roleName,
      assumeRolePolicy: JSON.stringify(rolePolicy),
      inlinePolicy: [
        new IamPolicy(this, "assume-role-policy-from-snapshot-export-lambda", {
          name: "rds-snapshot-export-policy",
          policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: "rds:DescribeDBClusterSnapshots",
                Resource: [
                  `arn:aws:rds:ap-northeast-1:${anotherAccountId}:cluster-snapshot:*`,
                  `arn:aws:rds:ap-northeast-1:${anotherAccountId}:cluster:${context.clusterIdentifier}`,
                ],
              },
              {
                Effect: "Allow",
                Action: "rds:StartExportTask",
                Resource: "*",
              },
              {
                Effect: "Allow",
                Action: ["iam:GetRole", "iam:PassRole"],
                Resource: `arn:aws:iam::${anotherAccountId}:role/${roleName}`,
              },
              {
                Effect: "Allow",
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
              {
                Action: [
                  "s3:DeleteObject",
                  "s3:GetObject",
                  "s3:PutObject",
                  "s3:ListBucket",
                  "s3:GetBucketLocation",
                ],
                Effect: "Allow",
                Resource: [`${bucketArn}/*`, bucketArn],
              },
            ],
          }),
        }),
      ],
    });
  }
}

const app = new App();
new MyStack(app, "dev");
new MyStack(app, "prod");
app.synth();
