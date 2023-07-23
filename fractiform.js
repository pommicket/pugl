'use strict';

/*
TODO:
- detect duplicate widget names
- forbid .,;|/\:(){}[]+-<>'"`~?!#%^&* in widget names
- widgets:
	- rotate 3D
- parse input expressions
- show which widget generated an error
   - don't make the error a whole big pop-up
   - switch 'change' event listener to 'input' for auto-update
*/

let gl;
let program_main = null;
let program_post = null;
let vertex_buffer_rect;
let vertex_buffer_main;
let vertex_data_main;
let canvas_container;
let canvas;
let ui_canvas;
let ui_ctx;
let framebuffer;
let framebuffer_color_texture;
let sampler_texture;
let current_time;
let ui_shown = true;
let ui_div;
let ui_resize;
let viewport_width, viewport_height;
let shift_key = false, ctrl_key = false;
let html_id = 0;
let widget_choices;
let widget_search;
let widgets_container;
let display_output;
let code_input;
let display_output_span = null;
let auto_update = true;

let width = 1920, height = 1920;

const widget_info = [
	`
//! name: Buffer
//! description: outputs its input unaltered. useful for defining constants.
//! x.name: input
` + ['float', 'vec2', 'vec3', 'vec4'].map((type) => `
${type} buffer(${type} x) {
	return x;
}`).join('\n'),
	`
//! .name: Mix
//! .description: weighted average of two inputs
//! a.name: source 1
//! a.default: 0
//! b.name: source 2
//! b.default: 1
//! x.name: mix
//! x.default: 0.5
//! c.name: clamp mix
//! c.type: checkbox
//! c.description: clamp the mix input to the [0, 1] range
` + ['float', 'vec2', 'vec3', 'vec4'].map((type) => `
${type} mix_(${type} a, ${type} b, ${type} x, int c) {
	if (c != 0) x = clamp(x, 0.0, 1.0);
	return mix(a, b, x);
}
`).join('\n'),
	`
//! .name: Last frame
//! .description: sample from the previous frame
//! pos.description: position to sample — bottom-left corner is (0, 0), top-right corner is (1, 1)
//! wrap.name: wrap mode
//! wrap.type: select:clamp|wrap
//! wrap.description: how to deal with the input components if they go outside [0, 1]
//! sample.name: sample mode
//! sample.type: select:linear|nearest
//! sample.description: how positions in between pixels should be sampled

vec3 last_frame(vec2 pos, int wrap, int sample) {
	if (wrap == 0)
		pos = mod(pos, 1.0);
	else if (wrap == 1)
		pos = clamp(pos, 0.0, 1.0);
	if (sample == 1)
		pos = floor(0.5 + pos * ff_texture_size) * (1.0 / ff_texture_size);
	return texture2D(ff_texture, pos).xyz;
}
`,
	`
//! .name: Weighted add
//! .description: add two numbers or vectors with weights
//! aw.name: a weight
//! aw.default: 1
//! bw.name: b weight
//! bw.default: 1

` + ['float', 'vec2', 'vec3', 'vec4'].map((type) => `
${type} wtadd(${type} a, float aw, ${type} b, float bw) {
	return a * aw + b * bw;
}
`).join('\n'),
	`
//! .name: Multiply
//! .description: multiply two numbers, scale a vector by a number, or perform component-wise multiplication between vectors
` + ['float', 'vec2', 'vec3', 'vec4'].map((type) => `
${type} mul(${type} a, ${type} b) {
	return a * b;
}
`).join('\n'),
	`
//! .name: Power
//! .description: take one number to the power of another
` + ['float', 'vec2', 'vec3', 'vec4'].map((type) => `
${type} pow_(${type} a, ${type} b) {
	return pow(a, b);
}
`).join('\n'),
	`
//! .name: Modulo
//! .description: wrap a value at a certain limit
//! b.default: 1
` + ['float', 'vec2', 'vec3', 'vec4'].map((type) => `
${type} mod_(${type} a, ${type} b) {
	return mod(a, b);
}
`).join('\n'),
	`
//! .name: Square
//! .description: select between two inputs depending on whether a point lies within a square (or cube in 3D)
//! pos.name: pos
//! pos.description: point to test
//! pos.default: .pos
//! inside.description: source to use if pos lies inside the square
//! inside.default: #f00
//! outside.description: source to use if pos lies outside the square
//! outside.default: #0f0
//! size.description: radius of the square
//! size.default: 0.5

` + [['float', 'a'], ['vec2', 'max(a.x, a.y)'], ['vec3', 'max(a.x, max(a.y, a.z))'], ['vec4', 'max(max(a.x, a.y), max(a.z, a.w))']].map((x) => {
	let type = x[0];
	let max = x[1];
	return ['float', 'vec2', 'vec3', 'vec4'].map((type2) => `
${type} square(${type} pos, ${type2} inside, ${type2} outside, ${type} size) {
	${type} a = pos / size;
	return ${max} < 1.0 ? inside : outside;
}
`).join('\n');
}).join('\n'),
	`
//! .name: Circle
//! .description: select between two inputs depending on whether a point lies within a circle (or sphere in 3D)
//! pos.default: .pos
//! pos.description: point to test
//! inside.default: #f00
//! inside.description: source to use if pos lies inside the circle
//! outside.default: #0f0
//! outside.description: source to use if pos lies outside the circle
//! size.default: 0.5
//! size.description: radius of the circle

`+ ['float', 'vec2', 'vec3', 'vec4'].map((type) => {
	return ['float', 'vec2', 'vec3', 'vec4'].map((type2) => `
${type} circle(${type} pos, ${type2} inside, ${type2} outside, ${type} size) {
	pos /= size;
	return dot(pos, pos) < 1.0 ? inside : outside;
}
`).join('\n');
}).join('\n'),
`
//! .name: Comparator
//! .description: select between two inputs depending on a comparison between two values
//! cmp1.name: compare 1
//! cmp1.description: input to compare against "Compare 2"
//! cmp2.name: compare 2
//! cmp2.default: 0
//! cmp2.description: input to compare against "Compare 1"
//! less.name: if less
//! less.default: 0
//! less.description: value to output if "Compare 1" < "Compare 2"
//! greater.name: if greater
//! greater.default: 1
//! greater.description: value to output if "Compare 1" ≥ "Compare 2"
` + ['float', 'vec2', 'vec3', 'vec4'].map((type) => `
${type} compare(float cmp1, float cmp2, ${type} less, ${type} greater) {
	return cmp1 < cmp2 ? less : greater;
}
`).join('\n'),
	`
//! .name: Sine wave
//! .description: a wave based on the sin function
//! t.description: position in the wave
//! t.default: .time
//! period.description: period of the wave
//! period.default: 1
//! amp.name: amplitude
//! amp.default: 1
//! amp.description: amplitude (maximum value) of the wave
//! phase.default: 0
//! phase.description: phase of the wave (0.5 = phase by ½ period)
//! center.name: baseline
//! center.default: 0
//! center.description: this value is added to the output at the end
//! nonneg.name: non-negative
//! nonneg.description: make the wave go from baseline to baseline+amp, rather than baseline-amp to baseline+amp
//! nonneg.type: checkbox

` + ['float', 'vec2', 'vec3', 'vec4'].map((type) => `
${type} sine_wave(${type} t, ${type} period, ${type} amp, ${type} phase, ${type} center, ${type} nonneg) {
	${type} v = sin((t / period - phase) * 6.2831853);
	if (nonneg) v = v * 0.5 + 0.5;
	return v;
}
`).join('\n'),
	`
//! .name: Rotate 2D
//! .description: rotate a 2-dimensional vector
//! v.description: vector to rotate
//! theta.name: θ
//! theta.description: angle to rotate by (in radians)
//! dir.name: direction
//! dir.description: direction of rotation
//! dir.type: select:CCW|CW

vec2 rotate2D(vec2 v, float theta, int dir) {
	if (dir == 1) theta = -theta;
	float c = cos(theta), s = sin(theta);
	return vec2(c*v.x - s*v.y, s*v.x + c*v.y);
}
`,
	`
//! .name: Hue shift
//! .description: shift hue of color
//! color.description: input color
//! shift.description: how much to shift hue by (0.5 = shift halfway across the rainbow)

vec3 hue_shift(vec3 color, float shift) {
	vec3 c = color;
	// rgb to hsv
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	float e = 1.0e-10;
	vec3 hsv = vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
	
	hsv.x = mod(hsv.x + shift, 1.0);
	c = hsv;
	
	// hsv to rgb
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`,
	`
//! .name: Clamp
//! .description: clamp a value between a minimum and maximum
//! val.name: value
//! val.description: input value
//! minimum.name: min
//! maximum.name: max
` + ['float', 'vec2', 'vec3', 'vec4'].map((type) => `
${type} clamp_(${type} x, ${type} minimum, ${type} maximum) {
	return clamp(x, minimum, maximum);
}
`).join('\n'),
];

let widget_ids_sorted_by_name = [];
for (let id in widget_info) { 
	widget_ids_sorted_by_name.push(id);
}
widget_ids_sorted_by_name.sort(function (a, b) {
	a = widget_info[a].name;
	b = widget_info[b].name;
	return a.localeCompare(b);
});

window.addEventListener('load', startup);

function set_ui_shown(to) {
	ui_shown = to;
	let ui_viz = to ? 'visible' : 'collapse';
	ui_div.style.visibility = ui_viz;
	ui_resize.style.visibility = ui_viz;
}

function rgba_hex_to_float(hex) {
	let r;
	let g;
	let b;
	let a;
	
	if (hex.length === 7 || hex.length === 9) {
		// #rrggbb or #rrggbbaa
		r = parseInt(hex.substring(1, 3), 16) / 255;
		g = parseInt(hex.substring(3, 5), 16) / 255;
		b = parseInt(hex.substring(5, 7), 16) / 255;
		a = hex.length === 7 ? 1 : parseInt(hex.substring(7, 9), 16) / 255;
	} else if (hex.length === 4 || hex.length === 5) {
		// #rgb or #rgba
		r = parseInt(hex[1], 16) / 15;
		g = parseInt(hex[2], 16) / 15;
		b = parseInt(hex[3], 16) / 15;
		a = hex.length === 4 ? 1 : parseInt(hex[4], 16) / 15;
	}

	if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
		return null;
	}
	
	let color = {
		r: r,
		g: g,
		b: b,
		a: a,
	};
	Object.preventExtensions(color);
	return color;
}

function rgba_float_to_hex(flt) {
	function comp(x) {
		x = Math.round(x * 255);
		if (x < 0) x = 0;
		if (x > 255) x = 255;
		let s = x.toString(16);
		while (s.length < 2) {
			s = '0' + s;
		}
		return s;
	}
	return '#' + comp(flt.r) + comp(flt.g) + comp(flt.b) + comp(flt.a);
}

function update_key_modifiers_from_event(e) {
	shift_key = e.shiftKey;
	ctrl_key = e.ctrlKey;
}

function update_shader() {
	let source = get_shader_source();
	if (source === null) {
		return;
	}
	let fragment_code = `
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D ff_texture;
uniform float ff_time;
uniform vec2 ff_texture_size;
varying vec2 ff_pos;

vec3 get_color() {
	${source}
}

void main() {
	gl_FragColor = vec4(get_color(), 1.0);
}
`;
	const vertex_code = `
attribute vec2 v_pos;
varying vec2 ff_pos;
void main() {
	ff_pos = v_pos;
	gl_Position = vec4(v_pos, 0.0, 1.0);
}
`;
	program_main = compile_program('main', {'vertex': vertex_code, 'fragment': fragment_code});
}

function on_key_press(e) {
	update_key_modifiers_from_event(e);
	let code = e.keyCode;
	if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
		return;
	}
	console.log('key press', code);
	
	switch (code) {
	case 32: // space
		if (canvas_is_target)
			perform_step();
		break;
	case 9: // tab
		set_ui_shown(!ui_shown);
		e.preventDefault();
		break;
	case 13: // return
		update_shader();
		e.preventDefault();
		break;
	}
}

function on_key_release(e) {
	update_key_modifiers_from_event(e);
}


function on_mouse_move(e) {
	update_key_modifiers_from_event(e);
}

function distance(p0, p1) {
	let dx = p0.x - p1.x;
	let dy = p0.y - p1.y;
	return Math.sqrt(dx * dx + dy * dy);
}

function on_click(e) {
	update_key_modifiers_from_event(e);
	if (!ui_shown) {
		return;
	}
}


function float_glsl(f) {
	if (isNaN(f)) return '(0.0 / 0.0)';
	if (f === Infinity) return '1e+1000';
	if (f === -Infinity) return '-1e+1000';
	let s = f + '';
	if (s.indexOf('.') !== -1 || s.indexOf('e') !== -1)
		return s;
	return s + '.0';
}

function type_component_count(type) {
	switch (type) {
	case 'float': return 1;
	case 'vec2': return 2;
	case 'vec3': return 3;
	case 'vec4': return 4;
	default:
		return 0;
	}
}

function type_base_type(type) {
	switch (type) {
	case 'float':
	case 'vec2':
	case 'vec3':
	case 'vec4':
		return 'float';
	default:
		return null;
	}
}

function type_vec(base_type, component_count) {
	switch (base_type) {
	case 'float':
		switch (component_count) {
		case 1: return 'float';
		case 2: return 'vec2';
		case 3: return 'vec3';
		case 4: return 'vec4';
		default:
			return null;
		}
	default:
		return null;
	}
}

function get_widget_by_name(name) {
	for (let w of document.getElementsByClassName('widget')) {
		if (get_widget_name(w) === name) {
			return w;
		}
	}
	return null;
}

function get_widget_name(widget_div) {
	let names = widget_div.getElementsByClassName('widget-name');
	console.assert(names.length === 1, 'there should be exactly one widget-name input per widget');
	return names[0].value;
}


function get_widget_names() {
	let s = new Set();
	for (let w of document.getElementsByClassName('widget-name')) {
		s.add(w.value);
	}
	return s;
}


function set_display_output_and_update_shader(to) {
	display_output = to;
	for (let widget of document.getElementsByClassName('widget')) {
		widget.dataset.display = to === get_widget_name(widget) ? '1' : '0';
	}
	update_shader();
}

function add_widget(func) {
	let info = widget_info[func];
	console.assert(info !== undefined, 'bad widget name: ' + func);
	console.assert('inputs' in info, `info for ${func} missing inputs member`);
	console.assert('controls' in info, `info for ${func} missing controls member`);
	console.assert('name' in info, `info for ${func} missing name member`);
	let root = document.createElement('div');
	root.dataset.func = func;
	root.classList.add('widget');
	
	{
		// delete button
		let delete_button = document.createElement('button');
		let delete_img = document.createElement('img');
		delete_img.src = 'x.svg';
		delete_img.alt = 'delete';
		delete_button.appendChild(delete_img);
		delete_button.classList.add('widget-delete');
		delete_button.addEventListener('click', function (e) {
			root.remove();
		});
		root.appendChild(delete_button);
	}
	
	{ // title
		let title = document.createElement('div');
		title.classList.add('widget-title');
		if ('tooltip' in info) {
			title.title = info.tooltip;
		}
		title.appendChild(document.createTextNode(info.name + ' '));
		let name_input = document.createElement('input');
		name_input.placeholder = 'Name';
		name_input.classList.add('widget-name');
		
		// generate unique name
		let names = get_widget_names();
		let i;
		for (i = 1; ; i++) {
			if (!names.has(func + i)) {
				break;
			}
		}
		name_input.value = func + i;
		
		title.appendChild(name_input);
		root.appendChild(title);
	}
	
	// inputs
	info.inputs.forEach(function (input) {
		let container = document.createElement('div');
		container.classList.add('in');
		console.assert('id' in input, 'input missing ID', input);
		container.dataset.id = input.id;
		let input_element = document.createElement('div');
		input_element.contentEditable = true;
		input_element.classList.add('entry');
		input_element.appendChild(document.createElement('br'));
		input_element.type = 'text';
		input_element.id = 'gen-input-' + (++html_id);
		let label = document.createElement('label');
		label.htmlFor = input_element.id;
		if ('tooltip' in input) {
			label.title = input.tooltip;
		}
		if ('dfl' in input) {
			input_element.innerText = input.dfl;
		}
		label.appendChild(document.createTextNode(input.name));
		container.appendChild(label);
		container.appendChild(document.createTextNode('='));
		container.appendChild(input_element);
		root.appendChild(container);
		root.appendChild(document.createTextNode(' '));
		
		input_element.addEventListener('change', function (e) {
			if (auto_update) {
				update_shader();
			}
		});
	});
	
	// controls
	for (let control of info.controls) {
		let container = document.createElement('div');
		container.classList.add('control');
		console.assert('id' in control, 'control missing ID', control);
		container.dataset.id = control.id;
		let type = control.type;
		let input;
		if (type === 'checkbox') {
			input = document.createElement('input');
			input.type = 'checkbox';
			if (control.dfl) {
				input.checked = 'checked';
			}
		} else if (type.startsWith('select:')) {
			let options = type.substring('select:'.length).split('|');
			
			input = document.createElement('select');
			for (let opt of options) {
				let option = document.createElement('option');
				option.appendChild(document.createTextNode(opt));
				option.value = opt;
				input.appendChild(option);
			}
			
			if ('dfl' in control) {
				input.value = dfl;
			}
		} else {
			console.error('bad control type');
		}
		
		input.addEventListener('change', function (e) {
			if (auto_update) {
				update_shader();
			}
		});
		
		input.id = 'gen-control-' + (++html_id);
		input.classList.add('control-input');
		let label = document.createElement('label');
		label.htmlFor = input.id;
		label.appendChild(document.createTextNode(control.name));
		if ('tooltip' in control) {
			label.title = control.tooltip;
		}
		container.appendChild(label);
		container.appendChild(document.createTextNode('='));
		container.appendChild(input);
		root.appendChild(container);
		root.appendChild(document.createTextNode(' '));
	}
	
	root.addEventListener('click', function (e) {
		if (e.target === root)
			set_display_output_and_update_shader(get_widget_name(root));
		e.preventDefault();
	});
	
	widgets_container.appendChild(root);
	return root;
}

class GLSLGenerationState {
	constructor(widgets) {
		this.widgets = widgets;
		this.code = [];
		this.computing_inputs = new Set();
		this.variable = 0;
	}
	
	next_variable() {
		this.variable += 1;
		return 'v' + this.variable;
	}
	
	add_code(code) {
		this.code.push(code);
	}
	
	get_code() {
		return this.code.join('');
	}
	
	compute_input(input) {
		input = input.trim();
		if (input.length === 0) {
			return {error: 'empty input'};
		}
		if (!isNaN(input)) {
			return { code: float_glsl(parseFloat(input)), type: 'float' };
		}
		
		if (input.indexOf(',') !== -1) {
			// vector construction
			let items = input.split(',');
			console.assert(items.length >= 2, 'huhhhhh??');
			let components = [];
			for (let item of items) {
				let input = this.compute_input(item);
				if ('error' in input) {
					return {error: input.error};
				}
				components.push(input);
			}
			let component_count = 0;
			let base_type = undefined;
			for (let component of components) {
				let type = component.type;
				let c = type_component_count(type);
				if (c === 0) {
					return {error: `cannot use type ${type} with ,`};
				}
				component_count += c;
				if (base_type === undefined) {
					base_type = type_base_type(type);
				}
				if (base_type !== type_base_type(type)) {
					return {error: 'bad combination of types for ,'};
				}
			}
			let type = type_vec(base_type, component_count);
			if (type === null) {
				// e.g. trying to combine 5 floats
				return {error: 'bad combination of types for ,'};
			}
			let v = this.next_variable();
			let component_values = components.map(function (c) { return c.code; });
			this.add_code(`${type} ${v} = ${type}(${component_values.join()});\n`);
			return {type: type, code: v};
		}
		
		if (input[0] === '#') {
			let color = rgba_hex_to_float(input);
			if (color === null) {
				return {error: 'bad color: ' + input};
			}
			return input.length === 4 || input.length === 7 ?
				{ code: `vec3(${float_glsl(color.r)},${float_glsl(color.g)},${float_glsl(color.b)})`, type: 'vec3' } :
				{ code: `vec4(${float_glsl(color.r)},${float_glsl(color.g)},${float_glsl(color.b)},${float_glsl(color.a)})`, type: 'vec4' };
		}
		
		let dot = input.lastIndexOf('.');
		let field = dot === -1 ? 'out' : input.substring(dot + 1);
		
		if (field.length === 0) {
			return {error: 'inputs should not end in .'};
		}
		
		if (field.length >= 1 && field.length <= 4 && field.split('').every(function (c) { return 'xyzw'.indexOf(c) !== -1 })) {
			// swizzle
			let vector = this.compute_input(input.substring(0, dot));
			if ('error' in vector) {
				return {error: vector.error};
			}
			let base = type_base_type(vector.type);
			let count = type_component_count(vector.type);
			
			for (let c of field) {
				let i = 'xyzw'.indexOf(c);
				if (i >= count) {
					return {error: `type ${vector.type} has no field ${c}.`};
				}
			}
			
			return {code: `(${vector.code}).${field}`, type: type_vec(base, field.length)};
		}
		
		if (dot === 0) {
			switch (input) {
			case '.pos':
				return {code: 'pos', type: 'vec2'};
			case '.pos01':
				return {code: '(0.5+0.5*pos)', type: 'vec2'};
			case '.time':
				return {code: 'u_time', type: 'float'};
			default:
				return {error: `no such builtin: ${input}`};
			}
		}
		
		if (field !== 'out') {
			return {error: `no such field: ${field}`};
		}
		let widget = this.widgets.get(input);
		if (widget === undefined) {
			return {error: `cannot find widget '${input}'`};
		}
		
		if (this.computing_inputs.has(input)) {
			return {error: 'circular dependency at ' + input};
		}
		this.computing_inputs.add(input);
		let value = this.compute_widget_output(widget);
		this.computing_inputs.delete(input);
		return value;
	}
	
	compute_widget_output(widget) {
		if (!('output' in widget)) {
			let info = widget_info[widget.func];
			let inputs = {};
			for (let input in widget.inputs) {
				let value = this.compute_input(widget.inputs[input]);
				if ('error' in value) {
					widget.output = {error: value.error};
					return {error: value.error};
				}
				inputs[input] = value;	
			}
			for (let control in widget.controls) {
				inputs[control] = widget.controls[control];
			}
			let output = info.func(this, inputs);
			widget.output = output;
		}
		
		let output = widget.output;
		if ('error' in output) {
			return {error: output.error};
		}
		return output;
	}
}

function parse_widgets() {
	let widgets = new Map();
	for (let widget_div of document.getElementsByClassName('widget')) {
		let name = get_widget_name(widget_div);
		let func = widget_div.dataset.func;
		if (!name) {
			return {error: `widget has no name. please give it one.`};
		}
		let inputs = {};
		let controls = {};
		for (let input of widget_div.getElementsByClassName('in')) {
			let id = input.dataset.id;
			inputs[id] = input.getElementsByClassName('entry')[0].innerText;
		}
		for (let control of widget_div.getElementsByClassName('control')) {
			let id = control.dataset.id;
			let input = control.getElementsByClassName('control-input')[0];
			let value;
			if (input.tagName === 'INPUT' && input.type == 'checkbox') {
				value = input.checked;
			} else {
				value = input.value;
			}
			controls[id] = value;
		}
		if (widgets.has(name)) {
			return {error: `duplicate widget name: ${name}`};
		}
		widgets.set(name, {
			func: func,
			inputs: inputs,
			controls: controls,
		});
	}
	return widgets;
}

function export_widgets() {
	let widgets = parse_widgets();
	if ('error' in widgets) {
		return {error: widgets.error};
	}
	console.assert(widgets instanceof Map);
	let data = [];
	for (let kv of widgets) {
		let name = kv[0];
		let widget = kv[1];
		data.push(widget.func);
		data.push(';');
		data.push('n:');
		data.push(name);
		data.push(';');
		for (let input in widget.inputs) {
			data.push('i');
			data.push(input);
			data.push(':');
			data.push(widget.inputs[input]);
			data.push(';');
		}
		for (let control in widget.controls) {
			data.push('c');
			data.push(control);
			data.push(':');
			data.push(widget.controls[control]);
			data.push(';');
		}
		data.pop(); // remove terminal separator
		data.push(';;');
	}
	data.push('_out=');
	data.push(display_output);
	return data.join('');
}

function import_widgets(string) {
	let widgets = [];
	let output = null;
	if (string) {
		console.log(string);
		for (let widget_str of string.split(';;')) {
			if (widget_str.startsWith('_out=')) {
				output = widget_str.substring('_out='.length);
				continue;
			}
			
			let parts = widget_str.split(';');
			let func = parts[0];
			let widget = {name: null, func: func, inputs: {}, controls: {}};
			let info = widget_info[func];
			parts.splice(0, 1);
			for (let part of parts) {
				let kv = part.split(':');
				if (kv.length !== 2) {
					return {error: `bad key-value pair (kv count ${kv.length})`};
				}
				let type = kv[0][0];
				let key = kv[0].substring(1);
				let value = kv[1];
				if (type === 'n') {
					// name
					widget.name = value;
				} else if (type === 'i') {
					// input
					widget.inputs[key] = value;
				} else if (type === 'c') {
					// control
					widget.controls[key] = value;
				} else {
					return {error: `bad widget part type: '${type}'`};
				}
			}
			
			if (widget.name === null) {
				return {error: 'widget has no name'};
			}
			widgets.push(widget);
		}
	} else {
		widgets = [
			{
				name: 'output',
				func: 'buffer',
				inputs: {input: '#acabff'},
				controls: {},
			}
		];
	}
	
	widgets_container.innerHTML = '';
	for (let widget of widgets) {
		let name = widget.name;
		if (!(widget.func in widget_info)) {
			return {error: `bad import string (widget type '${widget.func}' does not exist)`};
		}
		let element = add_widget(widget.func);
		element.getElementsByClassName('widget-name')[0].value = name;
		function assign_value(container, value) {
			let element = container.getElementsByTagName('input')[0];
			if (element === undefined) {
				element = container.getElementsByTagName('select')[0];
			}
			if (element === undefined) {
				element = container.getElementsByClassName('entry')[0];
			}
			if (element.type === 'checkbox') {
				element.checked = value === 'true' || value === '1' ? 'checked' : '';
			} else if (element.tagName === 'INPUT' || element.tagName === 'SELECT') {
				element.value = value;
			} else if (element.tagName === 'DIV') {
				element.innerText = value;
			} else {
				console.error('bad element', element);
			}
		}
		for (let input in widget.inputs) {
			let container = Array.from(element.getElementsByClassName('in')).find(
				function (e) { return e.dataset.id === input; }
			);
			assign_value(container, widget.inputs[input]);
		}
		for (let control in widget.controls) {
			let container = Array.from(element.getElementsByClassName('control')).find(
				function (e) { return e.dataset.id === control; }
			);
			assign_value(container, widget.controls[control]);
		}
	};
	
	set_display_output_and_update_shader(output);
}

function import_widgets_from_local_storage() {
	import_widgets(localStorage.getItem('widgets'));
}

function export_widgets_to_local_storage() {
	let widget_str = export_widgets();
	code_input.value = widget_str;
	localStorage.setItem('widgets', widget_str);
}

function get_shader_source() {
	if (!display_output) {
		show_error('no output chosen');
		return null;
	}
	let widgets = parse_widgets();
	if ('error' in widgets) {
		show_error(widgets.error);
		return null;
	}
	let state = new GLSLGenerationState(widgets);
	let output = state.compute_input(display_output);
	if ('error' in output) {
		show_error(output.error);
		return null;
	}
	
	switch (output.type) {
	case 'float':
		state.add_code(`return vec3(${output.code});\n`);
		break;
	case 'vec2':
		state.add_code(`return vec3(${output.code}, 0.0);\n`);
		break;
	case 'vec3':
		state.add_code(`return ${output.code};\n`);
		break;
	case 'vec4':
		state.add_code(`return ${output.code}.xyz;\n`);
		break;
	default:
		show_error(`bad type for output: ${output.type}`);
		return null;
	}
	
	let code = state.get_code();
	console.log(code);
	export_widgets_to_local_storage();
	return code;
}

function update_widget_choices() {
	let search_term = widget_search.value.toLowerCase();
	let choices = widget_choices.getElementsByClassName('widget-choice');
	widget_ids_sorted_by_name.forEach(function (id, i) {
		let name = widget_info[id].name;
		let choice = choices[i];
		let shown = name.toLowerCase().indexOf(search_term) !== -1;
	});
}


let resizing_ui = false;
let ui_resize_offset = 0;

function startup() {
	canvas_container = document.getElementById('canvas-container');
	canvas = document.getElementById('canvas');
	ui_div = document.getElementById('ui');
	ui_resize = document.getElementById('ui-resize');
	widget_choices = document.getElementById('widget-choices');
	widget_search = document.getElementById('widget-search');
	widgets_container = document.getElementById('widgets-container');
	code_input = document.getElementById('code');
	ui_div.style.flexBasis = ui_div.offsetWidth + "px"; // convert to px
	
	// drag to resize ui
	ui_resize.addEventListener('mousedown', function (e) {
		resizing_ui = true;
		let basis = ui_div.style.flexBasis;
		console.assert(basis.endsWith('px'));
		ui_resize_offset = basis.substring(0, basis.length - 2) - e.clientX;
		e.preventDefault();
	});
	window.addEventListener('mouseup', function (e) {
		resizing_ui = false;
	});
	window.addEventListener('mousemove', function (e) {
		if (resizing_ui) {
			if (e.buttons & 1) {
				ui_div.style.flexBasis = (e.clientX + ui_resize_offset) + "px";
			} else {
				resizing_ui = false;
			}
		}
		e.preventDefault();
	});
	
	document.getElementById('code-form').addEventListener('submit', function (e) {
		import_widgets(code_input.value);
	});
	
	gl = canvas.getContext('webgl');
	if (gl === null) {
		// support for very-old-but-not-ancient browsers
		gl = canvas.getContext('experimental-webgl');
		if (gl === null) {
			show_error('your browser doesnt support webgl.\noh well.');
			return;
		}
	}
	
	
	program_post = compile_program('post', {
		'vertex': `
attribute vec2 v_pos;
varying vec2 uv;
void main() {
	uv = v_pos * 0.5 + 0.5;
	gl_Position = vec4(v_pos, 0.0, 1.0);
}
`,
		'fragment': `
#ifdef GL_ES
precision highp float;
#endif
uniform sampler2D u_texture;
varying vec2 uv;
void main() {
	gl_FragColor = texture2D(u_texture, uv);
}
`,
	});
	if (program_post === null) {
		return;
	}
	
	vertex_buffer_rect = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_rect);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		-1.0, -1.0, 1.0, -1.0, 1.0, 1.0,
		-1.0, -1.0, 1.0, 1.0, -1.0, 1.0
	]), gl.STATIC_DRAW);
	
	vertex_buffer_main = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_main);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		-1.0, -1.0, 1.0, -1.0, 1.0, 1.0,
		-1.0, -1.0, 1.0, 1.0, -1.0, 1.0
	]), gl.STATIC_DRAW);
	
	framebuffer_color_texture = gl.createTexture();
	sampler_texture = gl.createTexture();
	
	// add widget buttons
	for (let id of widget_ids_sorted_by_name) {
		let widget = widget_info[id];
		let button = document.createElement('button');
		button.classList.add('widget-choice');
		if ('tooltip' in widget) {
			button.title = widget.tooltip;
		}
		button.appendChild(document.createTextNode(widget.name));
		widget_choices.appendChild(button);
		button.addEventListener('click', function (e) {
			add_widget(id);
		});
	}
	
	set_up_framebuffer();
	update_widget_choices();
	widget_search.addEventListener('input', function (e) {
		update_widget_choices();
	});
	import_widgets_from_local_storage();
	
	frame(0.0);
	window.addEventListener('keydown', on_key_press);
	window.addEventListener('keyup', on_key_release);
	window.addEventListener('mousemove', on_mouse_move);
	window.addEventListener('click', on_click);
	
}

function frame(time) {
	current_time = time * 1e-3;
	let container_width = canvas_container.offsetWidth;
	let container_height = canvas_container.offsetHeight;
	
	let aspect_ratio = width / height;
	let canvas_x = 0, canvas_y = 0;
	if (container_width / aspect_ratio < container_height) {
		// landscape mode
		canvas_y = Math.floor((container_height - viewport_height) * 0.5);
		viewport_width = container_width;
		viewport_height = Math.floor(container_width / aspect_ratio);
	} else {
		// portrait mode
		canvas_x = Math.floor((container_width - viewport_width) * 0.5);
		viewport_width = Math.floor(container_height * aspect_ratio);
		viewport_height = container_height;
	}
	
	canvas.width = viewport_width;
	canvas.height = viewport_height;
	canvas.style.left = canvas_x + 'px';
	canvas.style.top = canvas_y + 'px';
	
	let step = true;
	if (step) {
		perform_step();
	}
	
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.viewport(0, 0, viewport_width, viewport_height);
	gl.clearColor(0.0, 0.0, 0.0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	
	gl.useProgram(program_post);
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_rect);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, sampler_texture);
	gl.uniform1i(gl.getUniformLocation(program_post, 'u_texture'), 0);
	let v_pos = gl.getAttribLocation(program_post, 'v_pos');
	gl.enableVertexAttribArray(v_pos);
	gl.vertexAttribPointer(v_pos, 2, gl.FLOAT, false, 0, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	
	if (requestAnimationFrame == null) {
		show_error('your browser doesnt support requestAnimationFrame.\noh well.');
		return;
	}
	requestAnimationFrame(frame);
}

function perform_step() {
	if (width < 0 || program_main === null) {
		// not properly loaded yet
		return;
	}
	
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.viewport(0, 0, width, height);
	gl.clearColor(0.0, 0.0, 0.0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	
	gl.useProgram(program_main);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, sampler_texture);
	gl.uniform1i(gl.getUniformLocation(program_main, 'ff_texture'), 0);
	gl.uniform1f(gl.getUniformLocation(program_main, 'ff_time'), current_time % 3600);
	gl.uniform2f(gl.getUniformLocation(program_main, 'ff_texture_size'), width, height);
	
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_main);
	let v_pos = gl.getAttribLocation(program_main, 'v_pos');
	gl.enableVertexAttribArray(v_pos);
	gl.vertexAttribPointer(v_pos, 2, gl.FLOAT, false, 8, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	
	gl.bindTexture(gl.TEXTURE_2D, sampler_texture);
	gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);
}
	
function compile_program(name, shaders) {
	let program = gl.createProgram();
	for (let type in shaders) {
		let source = shaders[type];
		let gl_type;
		if (type === 'vertex') {
			gl_type = gl.VERTEX_SHADER;
		} else if (type === 'fragment') {
			gl_type = gl.FRAGMENT_SHADER;
		} else {
			show_error('unrecognized shader type: ' + type);
		}
		let shader = compile_shader(name + ' ' + type, gl_type, source);
		if (shader === null)
			return null;
		gl.attachShader(program, shader);
	}
	
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		show_error('Error linking shader program:\n' + gl.getProgramInfoLog(program));
		return null;
	}
	return program;
}

function set_up_framebuffer() {
	framebuffer = gl.createFramebuffer();
	let sampler_pixels = new Uint8Array(width * height * 4);
	sampler_pixels.fill(0);
	set_up_rgba_texture(sampler_texture, width, height, sampler_pixels);
	set_up_rgba_texture(framebuffer_color_texture, width, height, null);
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, framebuffer_color_texture, 0);
	let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		show_error('Error: framebuffer incomplete (status ' + status + ')');
		return;
	}
}

function set_up_rgba_texture(texture, width, height, pixels) {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
		gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function compile_shader(name, type, source) {
	let shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		show_error('Error compiling shader ' + name + ':\n' +
			gl.getShaderInfoLog(shader));
		return null;
	}
	return shader;
}

function show_error(error) {
	console.log('error:', error);
	document.getElementById('error-message').innerText = error;
	document.getElementById('error-dialog').showModal();
}
