
# @purepm/commit

## Description

@purepm/commit is a tool to generate commit messages using AI. It leverages the power of AI to create concise and informative commit messages based on your code changes.

## Installation

To install @purepm/commit, use npm:

```bash
npm install -g @purepm/commit
```

## Usage

### Setup

Before using @purepm/commit, you need to set it up by running:

```bash
mo-commit --setup
```

This will prompt you to configure the tool, including selecting your AI provider and entering your API token.

### Generate Commit Message

To generate a commit message, simply stage your changes and run:

```bash
mo-commit
```

You can also GPG-sign your commits by using the `-S` flag:

```bash
mo-commit -S
```

### Options

- `--setup`: Run the initial setup to configure the tool.
- `-S, --gpg-sign`: GPG-sign commits.

## Configuration

During setup, you will be prompted to provide the following information:
- AI provider (Currently supports Anthropic)
- API token
- Commit types to use

The configuration is saved in a file located at `~/.mo-commit-config.json`.

## License

This project is licensed under the MIT License.
