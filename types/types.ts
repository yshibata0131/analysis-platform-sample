export type Target = "dev" | "prod";

export type Config = {
  databaseName: string;
  clusterIdentifier: string;
  sampleAccountId: string;
  anotherAccountId: string;
  s3KmsKeyArn: string;
};
