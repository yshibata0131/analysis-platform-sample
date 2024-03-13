# analysis-platform-sample

## インフラ構築手順
```sh
cdktf init --template=typescript --local
npm install

// 状態管理用のS3バケットの作成処理のみをmain.tsに書く
// この時点では状態管理ファイルはローカルに作成される
// 他の記述を一旦削除するしかないと思う
npm run tfdeploy dev(prod)

// Remote Backend設定(S3Backend クラスをmain.tsに追記)
cd cdktf.out/stacks/dev(prod)
terraform init -migrate-state

// lambdaがassume roleするためのroleを別のアカウントに作成
// これは単発実行だしローカル管理。問題が出てきたら考える。
mkdir another-account-iam-role
cdktf init --template=typescript --local
npm install
// 別アカウントに作成するので、ここだけ別アカウントのIAM Roleにassume role
// ミスるとsample側にできてLambdaの実行に失敗するので注意
npm run tfdeploy dev
```

## デプロイ手順(ローカルから更新する場合)
基本的にパイプライン作ったあとはパイプラインでOK

```sh
// lambdaのbuild
// `GOARCH=amd64 GOOS=linux` をつけてbuildしないとLambda上で動かない
// build後のファイルをbootstrapとして出力しないとLambdaで動かない
cd lambda/export-another-account-rds-snapshot-to-s3/
GOARCH=amd64 GOOS=linux go build -o bootstrap main.go

cd ../../
// lambdaのbuild
cd lambda/update-glue-catalog-table/
GOARCH=amd64 GOOS=linux go build -o bootstrap main.go

cd ../../

npm run tfdeploy dev(prod)
```

## パイプライン構築手順

```sh
cd pipelines
cdk init --language typescript
npm install
```

## パイプラインデプロイ手順(最初の作成のみ。更新はパイプラインに任せればOK)

```sh
npm run cdk synth -c target=dev
npm run cdk deploy -c target=dev
```

## Lambdaの動作確認手順
stateMachineが作られるので、StepFunctionsの画面で実行を開始するだけ。入力は自由。
