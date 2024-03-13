import { Construct } from "constructs";
import { CloudwatchEventRule } from "../../.gen/providers/aws/cloudwatch-event-rule";
import { CloudwatchEventTarget } from "../../.gen/providers/aws/cloudwatch-event-target";
import { IamPolicy } from "../../.gen/providers/aws/iam-policy";
import { IamRole } from "../../.gen/providers/aws/iam-role";
import { SfnStateMachine } from "../../.gen/providers/aws/sfn-state-machine";
import { Target } from "../../types/types";

const eventBridgeRolePolicy = {
  Statement: [
    {
      Action: "sts:AssumeRole",
      Effect: "Allow",
      Principal: {
        Service: "events.amazonaws.com",
      },
    },
  ],
};

interface EventBridgeProps {
  cron: string;
  stateMachine: SfnStateMachine;
  stateMachineName: string;
  lambdaName: string;
  env: Target;
}

export const EventBridge = (scope: Construct, props: EventBridgeProps) => {
  const env = props.env;
  const lambdaName = props.lambdaName;
  const stateMachine = props.stateMachine;

  // Create EventBridge role
  const eventBridgeRole = new IamRole(
    scope,
    `${lambdaName}-event-bridge-role`,
    {
      name: `${lambdaName}-event-bridge-role-${env}`,
      assumeRolePolicy: JSON.stringify(eventBridgeRolePolicy),
      inlinePolicy: [
        new IamPolicy(scope, `${props.stateMachineName}-exec-policy"`, {
          name: `${props.stateMachineName}-exec-policy-${env}`,
          policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: "states:StartExecution",
                Resource: "*",
              },
            ],
          }),
        }),
      ],
    },
  );

  // create eventbridge rule
  const rule = new CloudwatchEventRule(
    scope,
    `${lambdaName}-eventbridge-rule`,
    {
      name: `${lambdaName}-eventbridge-rule-${env}`,
      description: `${lambdaName} event rule`,
      scheduleExpression: props.cron,
    },
  );

  // create eventbridge target
  return new CloudwatchEventTarget(scope, `${lambdaName}-eventbridge-target`, {
    rule: rule.name,
    arn: stateMachine.arn,
    roleArn: eventBridgeRole.arn,
  });
};
