package main

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	"github.com/aws/aws-sdk-go-v2/service/rds"
	"github.com/aws/aws-sdk-go-v2/service/rds/types"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

type EventData struct {
	S3BucketName   string `json:"s3BucketName"`
	S3BucketPrefix string `json:"s3BucketPrefix"`
	IamRoleArn     string `json:"iamRoleArn"`
	// kmsSKeiIdというパラメータ名だが、ARNを指定しないとエラーになるので注意
	KmsKeyId          string `json:"kmsKeyId"`
	ClusterIdentifier string `json:"clusterIdentifier"`
	DatabaseName      string `json:"databaseName"`
	ExportOnly        string `json:"exportOnly"`
}

const REGION = "ap-northeast-1"

func getRdsClient(event EventData, cfg aws.Config) *rds.Client {
	stsClient := sts.NewFromConfig(cfg)
	creds := stscreds.NewAssumeRoleProvider(stsClient, event.IamRoleArn)
	cfg.Credentials = aws.NewCredentialsCache(creds)
	return rds.NewFromConfig(cfg)
}

func exportSnapshot(ctx context.Context, rdsClient *rds.Client, event EventData) string {
	snapshot := findLastSnapshot(ctx, rdsClient, event.ClusterIdentifier)

	databaseName := event.DatabaseName
	exportTables := strings.Split(event.ExportOnly, ",")
	exportOnly := make([]string, len(exportTables))
	for i, table := range exportTables {
		exportOnly[i] = fmt.Sprintf("%s.%s", databaseName, table)
	}
	input := rds.StartExportTaskInput{
		ExportTaskIdentifier: generateIdentifierName(snapshot.DBClusterSnapshotIdentifier),
		SourceArn:            snapshot.DBClusterSnapshotArn,
		IamRoleArn:           &event.IamRoleArn,
		KmsKeyId:             &event.KmsKeyId,
		S3BucketName:         &event.S3BucketName,
		S3Prefix:             &event.S3BucketPrefix,
		ExportOnly:           exportOnly,
	}

	log.Print(fmt.Sprintf("StartExportTaskInput: %+v\n", input))

	output, err := rdsClient.StartExportTask(ctx, &input)

	if err != nil {
		log.Fatalf("Error on StartExportTask: %v", err)
	}

	log.Print(fmt.Sprintf("%+v\n", output))
	return fmt.Sprintf("%+v\n", output)
}

func generateIdentifierName(snapshotIdentifier *string) *string {
	// 1日に複数回実行されることを考慮して、スナップショットのIDに現在時刻を付与して一意な名前を生成する(日付ではない)
	hr, min, _ := time.Now().Clock()

	// スナップショットのIDは rds:xxx みたいな形式なので、先頭のrds:を除去してから名前を生成する
	return aws.String(fmt.Sprintf("%s-export-%d-%d", (*snapshotIdentifier)[4:], hr, min))
}

func findLastSnapshot(ctx context.Context, rdsClient *rds.Client, clusterIdentifier string) types.DBClusterSnapshot {
	input := rds.DescribeDBClusterSnapshotsInput{
		SnapshotType:        aws.String("automated"),
		DBClusterIdentifier: &clusterIdentifier,
	}

	result, err := rdsClient.DescribeDBClusterSnapshots(ctx, &input)
	if err != nil {
		log.Fatalf("Unable to DescribeDBSnapshots: %v", err)
	}

	snapshots := result.DBClusterSnapshots

	if len(snapshots) == 0 {
		log.Fatal("Snapshot not found!")
	}

	// 日時の降順でソート
	sort.Slice(snapshots, func(i, j int) bool {
		return snapshots[i].SnapshotCreateTime.Unix() > snapshots[j].SnapshotCreateTime.Unix()
	})

	return snapshots[0]
}

func HandleRequest(ctx context.Context, event EventData) (string, error) {
	log.Print(fmt.Sprintf("Receive event: %+v\n", event))
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(REGION),
	)
	if err != nil {
		return "", err
	}
	rdsClient := getRdsClient(event, cfg)

	return exportSnapshot(ctx, rdsClient, event), nil
}

func main() {
	lambda.Start(HandleRequest)
}
