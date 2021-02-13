import * as vscode from 'vscode';
import { TestSuiteInfo, TestInfo, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent } from 'vscode-test-adapter-api';
import * as fs from 'fs';
import * as readline from 'readline';
import { once } from 'events';

const readdir = async (path: fs.PathLike): Promise<string[]> =>
    new Promise((resolve, reject) =>
        fs.readdir(path, (err, content) =>
            err ? reject(err) : resolve(content)
        )
    );

enum Kind {
    Test,
    Suite,
}

interface Suite {
    kinds: Kind[];
    children: number[];
}

export interface ProjectTests {
    testSuiteInfo: TestSuiteInfo;
    mapping: { [id: string]: number };
    kinds: Kind[];
    indices: number[];
    suites: Suite[];
    filenames: string[];
    tests: string[];
}

const regex = /test\s*"(?<label>[^"]*)"/;

const loadTests = async (projectTests: ProjectTests, path: string, testInfos: TestInfo[], suite: Suite): Promise<void> => {
    const rl = readline.createInterface({
        input: fs.createReadStream(path),
        output: process.stdout,
        terminal: false
    });

    let row = 0;

    rl.on('line', (line) => {
        const match = regex.exec(line);
        if (match) {
            const label = match.groups?.label ?? '';
            const id = path + ' ' + label;
            testInfos.push({
                type: 'test',
                id: id,
                label: label,
                file: path,
                line: row
            });
            const test_id = projectTests.kinds.length;
            projectTests.mapping[id] = test_id;
            projectTests.kinds.push(Kind.Test);
            projectTests.indices.push(projectTests.tests.length);
            projectTests.filenames.push(path);
            projectTests.tests.push(label);
            suite.kinds.push(Kind.Test);
            suite.children.push(test_id);
        }
        row += 1;
    });

    await once(rl, 'close');
}

const loadTestSuite = async (projectTests: ProjectTests, path: string, children: (TestSuiteInfo | TestInfo)[]): Promise<void> => {
    const files = await readdir(path);
    for (const file of files) {
        if (file.endsWith('.zig')) {
            const filePath = path + '/' + file;
            projectTests.mapping[filePath] = projectTests.kinds.length;
            projectTests.kinds.push(Kind.Suite);
            projectTests.indices.push(projectTests.suites.length);
            let suite = {
                kinds: [],
                children: []
            };
            projectTests.suites.push(suite);
            let testInfos: TestInfo[] = [];
            await loadTests(projectTests, filePath, testInfos, suite);
            children.push({
                type: 'suite',
                id: filePath,
                label: file,
                children: testInfos,
            });
        }
    }
}

export const loadZigTests = async (workspace: vscode.WorkspaceFolder): Promise<ProjectTests> => {
    let projectTests: ProjectTests = {
        testSuiteInfo: {
            type: 'suite',
            id: 'root',
            label: 'Zig Test',
            children: [],
        },
        mapping: {},
        kinds: [],
        indices: [],
        suites: [],
        filenames: [],
        tests: [],
    };
    await loadTestSuite(projectTests, workspace.uri.path + '/tests', projectTests.testSuiteInfo.children);
    return projectTests;
}

type TestStatesEmitter = vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>;

export const runZigTests = async (projectTests: ProjectTests, tests: string[], testStatesEmitter: TestStatesEmitter): Promise<void> => {
    for (const test of tests) {
        const index = projectTests.mapping[test];
        await runTest(projectTests, index, test, testStatesEmitter);
    }
}

const runTest = async (projectTests: ProjectTests, index: number, test: string, testStatesEmitter: TestStatesEmitter,): Promise<void> => {
    switch (projectTests.kinds[index]) {
        case Kind.Suite:
            testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: test, state: 'running' });
            testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: test, state: 'completed' });
            break;
        case Kind.Test:
            testStatesEmitter.fire(<TestEvent>{ type: 'test', test: test, state: 'running' });
            testStatesEmitter.fire(<TestEvent>{ type: 'test', test: test, state: 'passed' });
            break;
    }
}
