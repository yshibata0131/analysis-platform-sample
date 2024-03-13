import * as path from "path";
import { AssetType, TerraformAsset } from "cdktf";
import { Construct } from "constructs";
import { IamPolicy } from "../../.gen/providers/aws/iam-policy";
import { IamRole } from "../../.gen/providers/aws/iam-role";
import { IamRolePolicyAttachment } from "../../.gen/providers/aws/iam-role-policy-attachment";
import { LambdaAlias } from "../../.gen/providers/aws/lambda-alias";
import { LambdaFunction } from "../../.gen/providers/aws/lambda-function";
import { S3Bucket } from "../../.gen/providers/aws/s3-bucket";
import { S3Object } from "../../.gen/providers/aws/s3-object";
import { Target } from "../../types/types";

const lambdaRolePolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Action: "sts:AssumeRole",
      Effect: "Allow",
      Principal: {
        Service: "lambda.amazonaws.com",
      },
    },
  ],
};

interface LambdaProps {
  lambdaName: string;
  env: Target;
  lambdaExecutableBucket: S3Bucket;
  policy: IamPolicy;
}

export const Lambda = (scope: Construct, props: LambdaProps) => {
  const env = props.env;

  const lambdaName = props.lambdaName;
  // lambdaのファイル群をzip化してs3にアップロード
  const asset = new TerraformAsset(scope, `${lambdaName}-asset`, {
    path: path.resolve(__dirname, `../../lambda/${lambdaName}`),
    type: AssetType.ARCHIVE,
  });
  const lambdaArchive = new S3Object(scope, `${lambdaName}-archive`, {
    bucket: props.lambdaExecutableBucket.bucket,
    key: `${lambdaName}/${asset.fileName}`,
    source: asset.path,
  });

  // Create Lambda role
  const lambdaRole = new IamRole(scope, `${lambdaName}-lambda-exec-role`, {
    name: `${lambdaName}-lambda-exec-role-${env}`,
    assumeRolePolicy: JSON.stringify(lambdaRolePolicy),
    inlinePolicy: [props.policy],
  });

  // LambdaがCloudWatchLogsにログを出力するためのポリシーをアタッチ
  new IamRolePolicyAttachment(scope, `${lambdaName}-lambda-managed-policy`, {
    policyArn:
      "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    role: lambdaRole.name,
  });

  // Create Lambda function
  const lambda = new LambdaFunction(scope, `${lambdaName}-lambda`, {
    functionName: `${lambdaName}-${env}`,
    s3Bucket: props.lambdaExecutableBucket.bucket,
    s3Key: lambdaArchive.key,
    handler: "main",
    runtime: "provided.al2023",
    sourceCodeHash: asset.assetHash,
    role: lambdaRole.arn,
  });
  new LambdaAlias(scope, `${lambdaName}-lambda-alias`, {
    functionName: lambda.functionName,
    functionVersion: lambda.version,
    name: "latest",
  });

  return lambda;
};
