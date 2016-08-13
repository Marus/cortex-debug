import * as assert from 'assert';
import { expandValue, isExpandable } from '../src/backend/gdb_expansion';

suite("GDB Value Expansion", () => {
	let variableCreate = (variable) => { return { expanded: variable }; };
	test("Various values", () => {
		assert.strictEqual(isExpandable(`false`), 0);
		assert.equal(expandValue(variableCreate, `false`), "false");
		assert.strictEqual(isExpandable(`5`), 0);
		assert.equal(expandValue(variableCreate, `5`), "5");
		assert.strictEqual(isExpandable(`"hello world!"`), 0);
		assert.equal(expandValue(variableCreate, `"hello world!"`), `"hello world!"`);
		assert.strictEqual(isExpandable(`0x7fffffffe956 "foobar"`), 0);
		assert.equal(expandValue(variableCreate, `0x7fffffffe956 "foobar"`), `"foobar"`);
		assert.strictEqual(isExpandable(`0x0`), 0);
		assert.equal(expandValue(variableCreate, `0x0`), "<nullptr>");
		assert.strictEqual(isExpandable(`0x000000`), 0);
		assert.equal(expandValue(variableCreate, `0x000000`), "<nullptr>");
		assert.strictEqual(isExpandable(`{...}`), 2);
		assert.equal(expandValue(variableCreate, `{...}`), "<...>");
		assert.strictEqual(isExpandable(`0x00abc`), 2);
		assert.equal(expandValue(variableCreate, `0x007ffff7ecb480`), "*0x007ffff7ecb480");
		assert.strictEqual(isExpandable(`{a = b, c = d}`), 1);
		assert.deepEqual(expandValue(variableCreate, `{a = b, c = d}`), [
			{
				name: "a",
				value: "b",
				variablesReference: 0
			}, {
				name: "c",
				value: "d",
				variablesReference: 0
			}]);
		assert.strictEqual(isExpandable(`{[0] = 0x400730 "foo", [1] = 0x400735 "bar"}`), 1);
		assert.deepEqual(expandValue(variableCreate, `{[0] = 0x400730 "foo", [1] = 0x400735 "bar"}`), [
			{
				name: "[0]",
				value: "\"foo\"",
				variablesReference: 0
			}, {
				name: "[1]",
				value: "\"bar\"",
				variablesReference: 0
			}]);
		assert.strictEqual(isExpandable(`{{a = b}}`), 1);
		assert.deepEqual(expandValue(variableCreate, `{{a = b}}`), [
			{
				name: "[0]",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "a",
							value: "b",
							variablesReference: 0
						}
					]
				}
			}
		]);
		assert.deepEqual(expandValue(variableCreate, `{1, 2, 3, 4}`), [
			{
				name: "[0]",
				value: "1",
				variablesReference: 0
			}, {
				name: "[1]",
				value: "2",
				variablesReference: 0
			}, {
				name: "[2]",
				value: "3",
				variablesReference: 0
			}, {
				name: "[3]",
				value: "4",
				variablesReference: 0
			}]);
	});
	test("Error values", () => {
		assert.strictEqual(isExpandable(`<No data fields>`), 0);
		assert.equal(expandValue(variableCreate, `<No data fields>`), "<No data fields>");
	});
	test("Nested values", () => {
		assert.strictEqual(isExpandable(`{a = {b = e}, c = d}`), 1);
		assert.deepEqual(expandValue(variableCreate, `{a = {b = e}, c = d}`), [
			{
				name: "a",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "b",
							value: "e",
							variablesReference: 0
						}
					]
				}
			}, {
				name: "c",
				value: "d",
				variablesReference: 0
			}]);
	});
	test("Simple node", () => {
		assert.strictEqual(isExpandable(`{a = false, b = 5, c = 0x0, d = "foobar"}`), 1);
		let variables = expandValue(variableCreate, `{a = false, b = 5, c = 0x0, d = "foobar"}`);
		assert.equal(variables.length, 4);
		assert.equal(variables[0].name, "a");
		assert.equal(variables[0].value, "false");
		assert.equal(variables[1].name, "b");
		assert.equal(variables[1].value, "5");
		assert.equal(variables[2].name, "c");
		assert.equal(variables[2].value, "<nullptr>");
		assert.equal(variables[3].name, "d");
		assert.equal(variables[3].value, `"foobar"`);
	});
	test("Complex node", () => {
		let node = `{quit = false, _views = {{view = 0x7ffff7ece1e8, renderer = 0x7ffff7eccc50, world = 0x7ffff7ece480}}, deltaTimer = {_flagStarted = false, _timeStart = {length = 0}, _timeMeasured = {length = 0}}, _start = {callbacks = 0x0}, _stop = {callbacks = 0x0}}`;
		assert.strictEqual(isExpandable(node), 1);
		let variables = expandValue(variableCreate, node);
		assert.deepEqual(variables, [
			{
				name: "quit",
				value: "false",
				variablesReference: 0
			},
			{
				name: "_views",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "[0]",
							value: "Object",
							variablesReference: {
								expanded: [
									{
										name: "view",
										value: "Object@*0x7ffff7ece1e8",
										variablesReference: { expanded: "*_views[0].view" }
									},
									{
										name: "renderer",
										value: "Object@*0x7ffff7eccc50",
										variablesReference: { expanded: "*_views[0].renderer" }
									},
									{
										name: "world",
										value: "Object@*0x7ffff7ece480",
										variablesReference: { expanded: "*_views[0].world" }
									}
								]
							}
						}
					]
				}
			},
			{
				name: "deltaTimer",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "_flagStarted",
							value: "false",
							variablesReference: 0
						},
						{
							name: "_timeStart",
							value: "Object",
							variablesReference: {
								expanded: [
									{
										name: "length",
										value: "0",
										variablesReference: 0
									}
								]
							}
						},
						{
							name: "_timeMeasured",
							value: "Object",
							variablesReference: {
								expanded: [
									{
										name: "length",
										value: "0",
										variablesReference: 0
									}
								]
							}
						}
					]
				}
			},
			{
				name: "_start",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "callbacks",
							value: "<nullptr>",
							variablesReference: 0
						}
					]
				}
			},
			{
				name: "_stop",
				value: "Object",
				variablesReference: {
					expanded: [
						{
							name: "callbacks",
							value: "<nullptr>",
							variablesReference: 0
						}
					]
				}
			}
		]);
	});
	test("Simple node with errors", () => {
		let node = `{_enableMipMaps = false, _minFilter = <incomplete type>, _magFilter = <incomplete type>, _wrapX = <incomplete type>, _wrapY = <incomplete type>, _inMode = 6408, _mode = 6408, _id = 1, _width = 1024, _height = 1024}`;
		assert.strictEqual(isExpandable(node), 1);
		let variables = expandValue(variableCreate, node);
		assert.deepEqual(variables, [
			{
				name: "_enableMipMaps",
				value: "false",
				variablesReference: 0
			},
			{
				name: "_minFilter",
				value: "<incomplete type>",
				variablesReference: 0
			},
			{
				name: "_magFilter",
				value: "<incomplete type>",
				variablesReference: 0
			},
			{
				name: "_wrapX",
				value: "<incomplete type>",
				variablesReference: 0
			},
			{
				name: "_wrapY",
				value: "<incomplete type>",
				variablesReference: 0
			},
			{
				name: "_inMode",
				value: "6408",
				variablesReference: 0
			},
			{
				name: "_mode",
				value: "6408",
				variablesReference: 0
			},
			{
				name: "_id",
				value: "1",
				variablesReference: 0
			},
			{
				name: "_width",
				value: "1024",
				variablesReference: 0
			},
			{
				name: "_height",
				value: "1024",
				variablesReference: 0
			}
		]);
	});
	test("lldb strings", () => {
		let node = `{ name = {...} }`;
		assert.strictEqual(isExpandable(node), 1);
		let variables = expandValue(variableCreate, node);
		assert.deepEqual(variables, [
			{
				name: "name",
				value: "...",
				variablesReference: { expanded: "name" }
			}
		]);
	});
});