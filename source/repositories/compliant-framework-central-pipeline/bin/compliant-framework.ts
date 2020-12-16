#!/usr/bin/env node
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

import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { EnvironmentPipelineStack } from '../lib/environment-pipeline-stack';
import { CorePipelineStack } from '../lib/core-pipeline-stack';

const PARAMETERS_KEY = 'parameters'
const CONTEXT_KEY_LOCAL_CONFIG_PATH = 'compliant-framework:localConfigPath'

/**
 *
 */
function main() {
    const app = new cdk.App();

    const configPath = app.node.tryGetContext(CONTEXT_KEY_LOCAL_CONFIG_PATH)
    if (configPath == "") {
        throw new Error(CONTEXT_KEY_LOCAL_CONFIG_PATH + ' not set in cdk.json')
    }

    const config = require(configPath);

    verifyConfig(config)
    configureAccounts(config)
    createStacks(app, config)
}

function verifyConfig(config: any) {
    if (config.partition === 'aws-us-gov' && config.core.primaryRegion != 'us-gov-west-1') {
        throw new Error("config.core.primaryRegion must be us-gov-west-1 when enabling AWS GovCloud (US)")
    }
}

/**
 *
 * @param config
 */
function configureAccounts(config: any) {
    var AWS = require("aws-sdk");
    AWS.config.update({ region: config.core.primaryRegion });

    // If running as the central account, update the SSM Params
    var sts = new AWS.STS();
    sts.getCallerIdentity({}, function (err: Error, data: any) {
        if (err) {
            console.log("Error", err);
        }
        else if (data.Account == config.central.accountId) {
            writeSsmParameters(config.central.ssmParameters, config.core.primaryRegion)

            // Write in the stackset parameters
            for (var stackSet in config.stackSets) {
                if (PARAMETERS_KEY in config.stackSets[stackSet]) {
                    let value = JSON.stringify(config.stackSets[stackSet][PARAMETERS_KEY])
                    let name = "/compliant/framework/central/stack-set/parameters/" + stackSet
                    writeSsmParameter(name, value, config.core.primaryRegion)

                }
            }

        }
        else {

            // Transit Account
            for (var region in config.transit) {
                for (var environment of config.environments) {
                    var accountId = config.transit[region].environments[environment].accountId;
                    if (data.Account == accountId) {
                        writeSsmParameters(config.transit[region].ssmParameters, region)
                    }
                }
            }

            // Management Services
            for (var region in config.managementServices) {
                for (var environment of config.environments) {
                    var accountId = config.managementServices[region].environments[environment].accountId;
                    if (data.Account == accountId) {
                        writeSsmParameters(config.managementServices[region].ssmParameters, region)
                    }
                }
            }

            // Plugins
            for (var item in config.plugins) {
                for (var region in config.plugins[item]) {
                    for (var action of config.plugins[item][region].actions) {
                        for (let environment in action.environments) {
                            if (data.Account == action.environments[environment].accountId) {
                                if ('ssmParameters' in action) {
                                    writeSsmParameters(action.ssmParameters, config.region)
                                }
                            }
                        }
                    }
                }
            }
        }
    });
}

/**
 *
 * @param name
 * @param value
 * @param region
 */
function writeSsmParameter(name: string, value: string, region: string) {
    var AWS = require("aws-sdk");
    AWS.config.update({ region });
    var ssm = new AWS.SSM();

    ssm.getParameter({ Name: name }, (err: Error, data: any) => {
        if (err) {
            const param = { Name: name, Value: value, Type: 'String', Overwrite: true };
            ssm.putParameter(param, (err: Error, data: Object) => {
                if (err) console.log(err, err.stack);
            });
        }
        else {
            if (value.localeCompare(data.Parameter.Value) != 0) {
                const param = { Name: name, Value: value, Type: 'String', Overwrite: true };
                ssm.putParameter(param, (err: Error, data: Object) => {
                    if (err) console.log(err, err.stack);
                });
            }
        }
    });
}

/**
 *
 * @param ssmParameters
 */
function writeSsmParameters(ssmParameters: any[], region: string) {
    for (var name in ssmParameters) {
        var value = ssmParameters[name].toString()
        writeSsmParameter(name, value, region)
    }
}


/**
 *
 * @param config
 */
function createStacks(app: cdk.App, config: any) {
    const solutionInfo = {
        builtBy: 'wwps-proserve-us-dod',
        name: 'compliant-framework-for-federal-and-dod-workloads-in-aws-govcloud-us',
        version: '1.0.0-000'
    }

    const env = {
        account: config.central.accountId,
        region: config.core.primaryRegion
    }

    // Core Pipeline
    new CorePipelineStack(app, 'core-pipeline-stack', {
        pipelineName: 'core-pipeline',
        env,
        environment: 'core',
        config,
        solutionInfo
    });

    // Environment Pipelines
    for (var environment of config.environments) {
        let pipelineName = 'environment-pipeline';
        if (environment !== 'default') {
            pipelineName = `environment-pipeline-${environment}`;
        }

        new EnvironmentPipelineStack(app, `${pipelineName}-stack`, {
            pipelineName,
            env,
            environment,
            config,
            solutionInfo
        });

    }
}

main()
