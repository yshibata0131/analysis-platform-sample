package main

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/athena"
	"github.com/aws/aws-sdk-go-v2/service/athena/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type EventData struct {
	S3BucketName   string `json:"s3BucketName"`
	DatabaseName   string `json:"databaseName"`
	OutputLocation string `json:"outputLocation"`
	WorkgroupName  string `json:"workgroupName"`
	TableNames     string `json:"tableNames"`
}

const REGION = "ap-northeast-1"

func getS3Client(cfg aws.Config) *s3.Client {
	return s3.NewFromConfig(cfg)
}

func getNewestSnapshot(s3Client *s3.Client, event EventData) (string, error) {
	bucketName := event.S3BucketName
	// 一旦全オブジェクトを取得
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(bucketName),
		Prefix: aws.String(""),
	}
	res, err := s3Client.ListObjectsV2(context.Background(), input)
	if err != nil {
		return "", err
	}
	objects := res.Contents
	if len(objects) == 0 {
		return "", fmt.Errorf("No snapshot found in %s", bucketName)
	}
	// 日時の降順にソート
	sort.Slice(objects, func(i, j int) bool {
		return objects[i].LastModified.After(*objects[j].LastModified)
	})
	return *objects[0].Key, nil
}

func getAthenaClient(cfg aws.Config) *athena.Client {
	return athena.NewFromConfig(cfg)
}

func execAthenaQuery(athenaClient *athena.Client, event EventData, prefix string) error {
	tableNames := strings.Split(event.TableNames, ",")
	for _, tableName := range tableNames {
		sql := fmt.Sprintf("ALTER TABLE `test-dwh`.`%s` SET LOCATION \"s3://%s/%s/%s/%s.%s/1/\";",
			tableName, event.S3BucketName, prefix, event.DatabaseName, event.DatabaseName, tableName)

		input := &athena.StartQueryExecutionInput{
			QueryExecutionContext: &types.QueryExecutionContext{
				Database: aws.String(event.DatabaseName),
			},
			ResultConfiguration: &types.ResultConfiguration{
				OutputLocation: aws.String(event.OutputLocation),
			},
			QueryString: aws.String(sql),
			WorkGroup:   aws.String(event.WorkgroupName),
		}
		_, err := athenaClient.StartQueryExecution(context.Background(), input)
		if err != nil {
			return err
		}
	}

	return nil
}

func HandleRequest(ctx context.Context, event EventData) error {
	log.Print(fmt.Sprintf("Receive event: %+v\n", event))
	cfg, err1 := config.LoadDefaultConfig(ctx,
		config.WithRegion(REGION),
	)
	if err1 != nil {
		return err1
	}
	s3Client := getS3Client(cfg)

	snapshot, err2 := getNewestSnapshot(s3Client, event)
	if err2 != nil {
		return err2
	}
	prefix := strings.Split(snapshot, "/")[0]
	athenaClient := getAthenaClient(cfg)
	return execAthenaQuery(athenaClient, event, prefix)
}

func main() {
	lambda.Start(HandleRequest)
}
