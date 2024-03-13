import { Construct } from "constructs";
import { IamPolicy } from "../../.gen/providers/aws/iam-policy";
import { IamRole } from "../../.gen/providers/aws/iam-role";
import { SfnStateMachine } from "../../.gen/providers/aws/sfn-state-machine";
import { Target } from "../../types/types";

const stepFunctionsRolePolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Action: "sts:AssumeRole",
      Effect: "Allow",
      Principal: {
        Service: "states.amazonaws.com",
      },
    },
  ],
};

interface StepFunctionsProps {
  lambdaName: string;
  env: Target;
  definition: string;
  stateMachineName: string;
  policy: IamPolicy;
}

export const StepFunctions = (scope: Construct, props: StepFunctionsProps) => {
  const env = props.env;
  const lambdaName = props.lambdaName;
  const stepFunctionsName = `${lambdaName}-step-functions`;

  // Create StepFunctions role
  const stepFunctionsRole = new IamRole(scope, `${stepFunctionsName}-role`, {
    name: `${stepFunctionsName}-role-${env}`,
    assumeRolePolicy: JSON.stringify(stepFunctionsRolePolicy),
    inlinePolicy: [props.policy],
  });

  return new SfnStateMachine(scope, `${stepFunctionsName}-sfn-state-machine`, {
    definition: props.definition,
    name: props.stateMachineName,
    roleArn: stepFunctionsRole.arn,
  });
};
