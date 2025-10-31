"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTest = runTest;
exports.getRunResult = getRunResult;
exports.listRuns = listRuns;
var child_process_1 = require("child_process");
var path_1 = require("path");
var promises_1 = require("fs/promises");
function runTest(options) {
    return __awaiter(this, void 0, void 0, function () {
        var dataDir, testId, testFile, runId, runDir, startTime;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    dataDir = options.dataDir, testId = options.testId;
                    testFile = path_1.default.join(dataDir, 'tests', "".concat(testId, ".spec.ts"));
                    runId = "".concat(new Date().toISOString().replace(/[:.]/g, '-'), "_").concat(testId);
                    runDir = path_1.default.join(dataDir, 'runs', runId);
                    return [4 /*yield*/, promises_1.default.mkdir(runDir, { recursive: true })];
                case 1:
                    _a.sent();
                    startTime = Date.now();
                    return [2 /*return*/, new Promise(function (resolve, reject) {
                            var proc = (0, child_process_1.spawn)('npx', [
                                'playwright', 'test',
                                testFile,
                                '--reporter=json'
                            ], {
                                cwd: dataDir,
                                env: __assign({}, process.env)
                            });
                            var stdout = '';
                            var stderr = '';
                            proc.stdout.on('data', function (data) {
                                stdout += data.toString();
                            });
                            proc.stderr.on('data', function (data) {
                                stderr += data.toString();
                            });
                            proc.on('close', function (code) { return __awaiter(_this, void 0, void 0, function () {
                                var endTime, duration, resultsPath, playwrightResults, resultsContent, err_1, latestDir, files, _i, files_1, file, err_2, status_1, error, tests, failed, failedTest, tracePath, runFiles, traceFile, err_3, result, err_4;
                                var _a, _b, _c, _d, _e;
                                return __generator(this, function (_f) {
                                    switch (_f.label) {
                                        case 0:
                                            endTime = Date.now();
                                            duration = endTime - startTime;
                                            _f.label = 1;
                                        case 1:
                                            _f.trys.push([1, 19, , 20]);
                                            resultsPath = path_1.default.join(dataDir, 'runs', 'latest', 'results.json');
                                            playwrightResults = void 0;
                                            _f.label = 2;
                                        case 2:
                                            _f.trys.push([2, 4, , 5]);
                                            return [4 /*yield*/, promises_1.default.readFile(resultsPath, 'utf-8')];
                                        case 3:
                                            resultsContent = _f.sent();
                                            playwrightResults = JSON.parse(resultsContent);
                                            return [3 /*break*/, 5];
                                        case 4:
                                            err_1 = _f.sent();
                                            playwrightResults = null;
                                            return [3 /*break*/, 5];
                                        case 5:
                                            latestDir = path_1.default.join(dataDir, 'runs', 'latest');
                                            _f.label = 6;
                                        case 6:
                                            _f.trys.push([6, 12, , 13]);
                                            return [4 /*yield*/, promises_1.default.readdir(latestDir)];
                                        case 7:
                                            files = _f.sent();
                                            _i = 0, files_1 = files;
                                            _f.label = 8;
                                        case 8:
                                            if (!(_i < files_1.length)) return [3 /*break*/, 11];
                                            file = files_1[_i];
                                            if (!(file.endsWith('.zip') || file.endsWith('.webm') || file.endsWith('.png'))) return [3 /*break*/, 10];
                                            return [4 /*yield*/, promises_1.default.rename(path_1.default.join(latestDir, file), path_1.default.join(runDir, file))];
                                        case 9:
                                            _f.sent();
                                            _f.label = 10;
                                        case 10:
                                            _i++;
                                            return [3 /*break*/, 8];
                                        case 11: return [3 /*break*/, 13];
                                        case 12:
                                            err_2 = _f.sent();
                                            return [3 /*break*/, 13];
                                        case 13:
                                            status_1 = 'passed';
                                            error = void 0;
                                            if (playwrightResults === null || playwrightResults === void 0 ? void 0 : playwrightResults.suites) {
                                                tests = playwrightResults.suites.flatMap(function (s) { return s.specs || []; });
                                                failed = tests.some(function (t) {
                                                    var _a;
                                                    return (_a = t.tests) === null || _a === void 0 ? void 0 : _a.some(function (test) { var _a; return (_a = test.results) === null || _a === void 0 ? void 0 : _a.some(function (r) { return r.status === 'failed'; }); });
                                                });
                                                if (failed) {
                                                    status_1 = 'failed';
                                                    failedTest = tests.find(function (t) {
                                                        var _a;
                                                        return (_a = t.tests) === null || _a === void 0 ? void 0 : _a.some(function (test) { var _a; return (_a = test.results) === null || _a === void 0 ? void 0 : _a.some(function (r) { return r.status === 'failed'; }); });
                                                    });
                                                    error = ((_e = (_d = (_c = (_b = (_a = failedTest === null || failedTest === void 0 ? void 0 : failedTest.tests) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.results) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.error) === null || _e === void 0 ? void 0 : _e.message) || 'Test failed';
                                                }
                                            }
                                            else if (code !== 0) {
                                                status_1 = 'failed';
                                                error = stderr || 'Test execution failed';
                                            }
                                            tracePath = void 0;
                                            _f.label = 14;
                                        case 14:
                                            _f.trys.push([14, 16, , 17]);
                                            return [4 /*yield*/, promises_1.default.readdir(runDir)];
                                        case 15:
                                            runFiles = _f.sent();
                                            traceFile = runFiles.find(function (f) { return f.endsWith('.zip'); });
                                            if (traceFile) {
                                                tracePath = path_1.default.join(runDir, traceFile);
                                            }
                                            return [3 /*break*/, 17];
                                        case 16:
                                            err_3 = _f.sent();
                                            return [3 /*break*/, 17];
                                        case 17:
                                            result = {
                                                id: runId,
                                                testId: testId,
                                                status: status_1,
                                                duration: duration,
                                                startedAt: new Date(startTime).toISOString(),
                                                endedAt: new Date(endTime).toISOString(),
                                                tracePath: tracePath,
                                                error: error
                                            };
                                            // Save result.json
                                            return [4 /*yield*/, promises_1.default.writeFile(path_1.default.join(runDir, 'result.json'), JSON.stringify(result, null, 2))];
                                        case 18:
                                            // Save result.json
                                            _f.sent();
                                            resolve(result);
                                            return [3 /*break*/, 20];
                                        case 19:
                                            err_4 = _f.sent();
                                            reject(new Error("Failed to process test results: ".concat(err_4.message)));
                                            return [3 /*break*/, 20];
                                        case 20: return [2 /*return*/];
                                    }
                                });
                            }); });
                        })];
            }
        });
    });
}
function getRunResult(dataDir, runId) {
    return __awaiter(this, void 0, void 0, function () {
        var resultPath, content;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    resultPath = path_1.default.join(dataDir, 'runs', runId, 'result.json');
                    return [4 /*yield*/, promises_1.default.readFile(resultPath, 'utf-8')];
                case 1:
                    content = _a.sent();
                    return [2 /*return*/, JSON.parse(content)];
            }
        });
    });
}
function listRuns(dataDir, testId) {
    return __awaiter(this, void 0, void 0, function () {
        var runsDir, runDirs, runs, validRuns, err_5;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    runsDir = path_1.default.join(dataDir, 'runs');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, promises_1.default.readdir(runsDir)];
                case 2:
                    runDirs = _a.sent();
                    return [4 /*yield*/, Promise.all(runDirs
                            .filter(function (dir) { return dir !== 'latest'; })
                            .map(function (dir) { return __awaiter(_this, void 0, void 0, function () {
                            var result, _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        _b.trys.push([0, 2, , 3]);
                                        return [4 /*yield*/, getRunResult(dataDir, dir)];
                                    case 1:
                                        result = _b.sent();
                                        return [2 /*return*/, result];
                                    case 2:
                                        _a = _b.sent();
                                        return [2 /*return*/, null];
                                    case 3: return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 3:
                    runs = _a.sent();
                    validRuns = runs.filter(function (run) { return run !== null; });
                    if (testId) {
                        return [2 /*return*/, validRuns
                                .filter(function (run) { return run.testId === testId; })
                                .sort(function (a, b) { return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(); })];
                    }
                    return [2 /*return*/, validRuns.sort(function (a, b) {
                            return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
                        })];
                case 4:
                    err_5 = _a.sent();
                    return [2 /*return*/, []];
                case 5: return [2 /*return*/];
            }
        });
    });
}
