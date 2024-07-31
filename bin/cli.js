#!/usr/bin/env node

import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { Anthropic } from '@anthropic-ai/sdk';
import chalk from 'chalk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import os from 'os';

const prompt = inquirer.createPromptModule();

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
    .option('S', {
        alias: 'gpg-sign',
        type: 'boolean',
        description: 'GPG-sign commits'
    })
    .option('setup', {
        type: 'boolean',
        description: 'Run setup'
    })
    .help()
    .argv;

const defaultCommitTypes = [
    { name: 'feat', description: 'A new feature', checked: true },
    { name: 'fix', description: 'A bug fix', checked: true },
    { name: 'docs', description: 'Documentation only changes', checked: false },
    { name: 'style', description: 'Changes that do not affect the meaning of the code', checked: false },
    { name: 'refactor', description: 'A code change that neither fixes a bug nor adds a feature', checked: false },
    { name: 'perf', description: 'A code change that improves performance', checked: false },
    { name: 'test', description: 'Adding missing tests or correcting existing tests', checked: false },
    { name: 'chore', description: 'Changes to the build process or auxiliary tools', checked: true },
];

function getGlobalConfigPath() {
    return path.join(os.homedir(), '.mo-commit-config.json');
}

async function setup() {
    console.log(chalk.blue('Running setup...'));

    const questions = [
        {
            type: 'list',
            name: 'aiProvider',
            message: 'Which AI provider do you want to use?',
            choices: ['Anthropic'],
        },
        {
            type: 'input',
            name: 'apiToken',
            message: 'Enter your API token:',
            validate: input => input.length > 0 ? true : 'Please enter a valid token.',
        },
        {
            type: 'checkbox',
            name: 'commitTypes',
            message: 'Select the commit types you want to use:',
            choices: defaultCommitTypes.map(type => ({
                name: `${type.name} - ${type.description}`,
                value: type,
                checked: type.checked
            })),
            validate: (answer) => {
                if (answer.length < 1) {
                    return 'You must choose at least one commit type.';
                }
                return true;
            },
        },
        {
            type: 'input',
            name: 'customCommitTypes',
            message: 'Enter any additional custom commit types (comma-separated, format: type:description):',
            filter: (input) => input.split(',').map(type => {
                const [name, description] = type.split(':').map(s => s.trim());
                return { name, description };
            }).filter(type => type.name && type.description),
        },
    ];

    const answers = await prompt(questions);

    // Combine selected types with custom types
    answers.commitTypes = [...answers.commitTypes, ...answers.customCommitTypes];
    delete answers.customCommitTypes;

    // Save configuration
    const config = JSON.stringify(answers, null, 2);
    const configPath = getGlobalConfigPath();

    await fs.writeFile(configPath, config);

    console.log(chalk.green(`Configuration saved in ${configPath}`));
}

async function defaultCommand() {
    console.log(chalk.blue('Executing commit...'));

    const configPath = getGlobalConfigPath();

    try {
        await fs.access(configPath);
    } catch (error) {
        console.log(chalk.red('Configuration not found. Please run "commit --setup" first.'));
        return;
    }

    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));

    if (config.aiProvider !== 'Anthropic') {
        console.log(chalk.yellow('This command only works with Anthropic for now.'));
        return;
    }

    // Read files in staging and get diff
    const { files: stagedFiles, diff } = await getStagedFilesAndDiff();

    if (stagedFiles.length === 0 || stagedFiles[0] === '') {
        console.log(chalk.yellow('No files in staging. Add files before committing.'));
        return;
    }

    // Read the content of staged files
    const filesContent = await getFilesContent(stagedFiles);

    // Generate commit message using Claude
    const commitMessage = await generateCommitMessage(config.apiToken, filesContent, diff, config.commitTypes);

    console.log(chalk.cyan('\n=== Generated Commit Message ==='));
    console.log(chalk.white('----------------------------------'));
    
    // Split the commit message into subject and body
    const [subject, ...body] = commitMessage.split('\n');
    
    console.log(chalk.green.bold(subject));  // Print subject in green and bold
    if (body.length > 0) {
        console.log(chalk.white('----------------------------------'));
        console.log(chalk.white(body.join('\n')));  // Print body in white
    }
    console.log(chalk.white('----------------------------------\n'));

    // Ask for confirmation
    const { confirmCommit } = await prompt([
        {
            type: 'confirm',
            name: 'confirmCommit',
            message: 'Do you want to use this message?',
        }
    ]);

    if (confirmCommit) {
        await makeCommit(commitMessage, argv.S);
        console.log(chalk.green('Commit successfully made.'));
    } else {
        console.log(chalk.yellow('Commit cancelled.'));
    }
}

async function getStagedFilesAndDiff() {
    return new Promise((resolve, reject) => {
        exec('git diff --cached --name-only', (error, stdout, stderr) => {
            if (error) {
                reject(`Error getting staged files: ${error.message}`);
                return;
            }
            if (stderr) {
                reject(`Error getting staged files: ${stderr}`);
                return;
            }
            const files = stdout.trim().split('\n');
            
            // Get the diff for staged files
            exec('git diff --cached', (diffError, diffStdout, diffStderr) => {
                if (diffError) {
                    reject(`Error getting diff: ${diffError.message}`);
                    return;
                }
                if (diffStderr) {
                    reject(`Error getting diff: ${diffStderr}`);
                    return;
                }
                resolve({ files, diff: diffStdout });
            });
        });
    });
}

async function getFilesContent(files) {
    let content = '';
    for (const file of files) {
        content += `File: ${file}\n`;
        content += await fs.readFile(file, 'utf8');
        content += '\n\n';
    }
    return content;
}

async function generateCommitMessage(apiToken, filesContent, diff, commitTypes) {
    const anthropic = new Anthropic({
        apiKey: apiToken,
    });

    const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 1024,
        messages: [
            {
                role: "user",
                content: `
                Analyze the following Git diff and file contents to generate a concise, informative commit message following these best practices:

                1. Start with a commit type prefix followed by a colon and space. Use one of these types:
                    ${commitTypes.map(type => `- ${type.name}: ${type.description}`).join('\n                    ')}

                2. After the type, use the imperative mood (e.g., 'add feature' not 'added feature')
                3. Keep the first line (subject) under 50 characters, including the type
                4. The whole commit message and title must be on lower case always
                5. Do not end the subject line with a period
                6. Separate subject from body with a blank line
                7. Wrap the body at 72 characters
                8. Use the body to explain what and why, not how

                If multiple files or significant changes are involved, use a multi-line commit message with a brief subject line followed by a more detailed explanation in the body.

                <filescontent>
                ${filesContent}
                </filescontent>


                <diff>
                ${diff}
                </diff>

                Generate the commit message now using the provided information and return only the commit message without explanations.:
                `
            }
        ]
    });

    return response.content[0].text;
}

async function makeCommit(message, sign = false) {
    const signFlag = sign ? '-S ' : '';
    return new Promise((resolve, reject) => {
        exec(`git commit ${signFlag}-m "${message}"`, (error, stdout, stderr) => {
            if (error) {
                reject(`Error making commit: ${error.message}`);
                return;
            }
            if (stderr) {
                console.warn(chalk.yellow(`Warning while making commit: ${stderr}`));
            }
            resolve(stdout);
        });
    });
}

if (argv.setup) {
    setup();
} else {
    defaultCommand();
}