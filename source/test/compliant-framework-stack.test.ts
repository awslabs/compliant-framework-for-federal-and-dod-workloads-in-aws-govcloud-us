/**********************************************************************************************************************
 *  Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

import * as cdk from '@aws-cdk/core';
import { CompliantFrameworkStack } from '../lib/compliant-framework-stack'
import { SynthUtils } from '@aws-cdk/assert';
import '@aws-cdk/assert/jest';

test('Stack creation', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new CompliantFrameworkStack(app, 'CompliantFramework',
    {
      description: '(SO0130) - Compliant Framework for Federal and DoD Workloads in AWS GovCloud (US). Version %%VERSION%%',
      solutionID: 'SO0130',
      solutionName: 'compliant-framework-for-federal-and-dod-workloads-in-aws-govcloud-us'
    });

  // THEN
  expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot(
    {
      Resources: {
        executeStateMachine: {
          Properties: {
            Date: expect.anything()
          }
        }
      }
    }
  );
});
