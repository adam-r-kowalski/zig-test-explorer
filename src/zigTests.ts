import * as vscode from 'vscode';
import { TestSuiteInfo, TestInfo, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';
import * as fs from 'fs';
import * as readline from 'readline';
import { once } from 'events';

const zigTestSuite: TestSuiteInfo = {
    type: 'suite',
    id: 'root',
    label: 'Zig Test', // the label of the root node should be the name of the testing framework
    children: [
        {
            type: 'suite',
            id: 'nested',
            label: 'Nested suite',
            children: [
                {
                    type: 'test',
                    id: 'test1',
                    label: 'Test #1'
                },
                {
                    type: 'test',
                    id: 'test2',
                    label: 'Test #2'
                }
            ]
        },
        {
            type: 'test',
            id: 'test3',
            label: 'Test #3'
        },
        {
            type: 'test',
            id: 'test4',
            label: 'Test #4'
        }
    ]
};

const readdir = async (path: fs.PathLike): Promise<string[]> =>
    new Promise((resolve, reject) =>
        fs.readdir(path, (err, content) =>
            err ? reject(err) : resolve(content)
        )
    );

const loadTests = async (path: string): Promise<TestInfo[]> => {
    let children: TestInfo[] = [];

    const rl = readline.createInterface({
        input: fs.createReadStream(path),
        output: process.stdout,
        terminal: false
    });

    const regex = /test\s*"(?<name>[^"]*)"/;
    let row = 0;

    rl.on('line', (line) => {
        const match = regex.exec(line);
        if (match) {
            children.push({
                type: 'test',
                id: path + '/' + line,
                label: match.groups?.name ?? 'anonymous',
                file: path,
                line: row
            });
        }
        row += 1;
    });

    await once(rl, 'close');
    return children;
}

const loadTestSuite = async (path: fs.PathLike): Promise<TestSuiteInfo[]> => {
    let children: TestSuiteInfo[] = [];
    const files = await readdir(path);
    for (const file of files) {
        if (file.endsWith('.zig')) {
            const filePath = path + '/' + file;
            children.push({
                type: 'suite',
                id: filePath,
                label: file,
                children: await loadTests(filePath)
            });
        }
    }
    return children;
}

export const loadZigTests = async (workspace: vscode.WorkspaceFolder): Promise<TestSuiteInfo> => ({
    type: 'suite',
    id: 'root',
    label: 'Zig Test',
    children: await loadTestSuite(workspace.uri.path + '/tests'),
});

export async function runFakeTests(
    tests: string[],
    testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>
): Promise<void> {
    for (const suiteOrTestId of tests) {
        const node = findNode(zigTestSuite, suiteOrTestId);
        if (node) {
            await runNode(node, testStatesEmitter);
        }
    }
}

function findNode(searchNode: TestSuiteInfo | TestInfo, id: string): TestSuiteInfo | TestInfo | undefined {
    if (searchNode.id === id) {
        return searchNode;
    } else if (searchNode.type === 'suite') {
        for (const child of searchNode.children) {
            const found = findNode(child, id);
            if (found) return found;
        }
    }
    return undefined;
}

async function runNode(
    node: TestSuiteInfo | TestInfo,
    testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>
): Promise<void> {

    if (node.type === 'suite') {

        testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'running' });

        for (const child of node.children) {
            await runNode(child, testStatesEmitter);
        }

        testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'completed' });

    } else { // node.type === 'test'

        testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'running' });

        testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'passed' });

    }
}
