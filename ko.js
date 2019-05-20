const ko = (() => {
	// TODO: nejak udelat applyBindings nad uz vykreslenym DOMem
	// kvuli rychlejsimu nacitani a SSR
	// kvuli SSR by melo jit ty bindingy serializovat a poslat v jsonu
	// na klienta
	const CHILD_NODES = 'childNodes',
		IDENTITY = v => v,
		DATA_IF = function DATA_IF(v, node) {
			// dodelat hierarchii
			const r = node.attributes['data-if'].value,
				pair = r.split(':').map(v => v.trim());
			return v != pair[1];
		},
		DATA_HIDE = v => v ? 'none' : '',
		CHANGE_TAGNAME = (tagName, node) => {	
			const el = document.createElement(tagName);			
			
			const attrs = node.attributes['data-attrs'].value,
				pairs = attrs.split(';');
			let tmp, attr, mapping;
	
			for (const pair of pairs) {
				tmp = pair.split(':');
				attr = tmp[0].trim();
				el[attr] = node[attr];
			}
			
			for (const attr of node.attributes) {
				el.setAttribute(attr.name, attr.value);
			}
			
			for (const child of node.childNodes) {
				el.appendChild(child);
			}
			
			node.parentNode.replaceChild(el, node);

			return el;
		},
		bindingFns = {
			'IDENTITY': IDENTITY,
			'DATA_IF': DATA_IF,
			'DATA_HIDE': DATA_HIDE,
			'CHANGE_TAGNAME': CHANGE_TAGNAME
		};

	function initTmpl(id, isTmpl) {
		const $tmpl = id instanceof HTMLElement
						? isTmpl
							? id.content : id
						: isTmpl
							? document.getElementById(id).content
							: document.getElementById(id);

		const bindings = {},
			mappings = {},
			events = {},
			stack = [$tmpl],
			addr = [],
			re = /{{(.+)}}/;

		let node, nl, nv, name, val, m, parseChildren = true;
		while(stack.length) {
			node = stack.pop();
		
			if (nv = node.nodeValue) {
				if (m = nv.match(re)) {
					(mappings[m[1]] = mappings[m[1]] || []).push([[...addr], ['nodeValue'], 'IDENTITY']);
				}
			}
			
			// zpracjeme si attributy
			if (node.attributes) {

				let attrsToRemove = [];
				
				for (let i = 0; i < node.attributes.length; i++) {
					name = node.attributes[i].name;
					val = node.attributes[i].value;

					//2-way data bindings:
					if (name == "contenteditable" && (m = node.innerText.match(re))) {
						// TODO handlovat uppercase
						// navesit eventhandler;
						(bindings[m[1]] = bindings[m[1]] || []).push({input: [...addr, 'innerText']});
					}

					if (name == 'value' && (m = val.match(re))) {						
						(bindings[m[1]] = bindings[m[1]] || []).push({keyup: [...addr, 'value']});
						(mappings[m[1]] = mappings[m[1]] || []).push([[...addr], ['value'], 'IDENTITY']);
					}

					if (name == 'checked' && (m = val.match(re))) {
						(bindings[m[1]] = bindings[m[1]] || []).push({change: [...addr, 'checked']});
						(mappings[m[1]] = mappings[m[1]] || []).push([[...addr], ['checked'], 'IDENTITY']);
						attrsToRemove.push('checked');
					}

					if (name == 'data-ev') {
						let pairs = val.split(';'),
							tmp, ev, callback;
						for (const pair of pairs) {
							tmp = pair.split(':');
							ev = tmp[0].trim();
							callback = tmp[1].trim();
							(events[callback] = events[callback] || []).push([ev, [...addr]]);
						}
					}

					if (name == 'data-hide') {
						(mappings[val] = mappings[val] || []).push([[...addr], ['style', 'display'], 'DATA_HIDE']);
					}

					if (name == 'data-if') {
						let pair = val.split(':');
						//TODO mit moznost jak referencovat parenty
						// mit moznost porovnavat hodnoty s hodnotama s modelu mezi sebou
						// ja budu potrebovat pak zaregistrovat na zmeny ten node u parentova klice? tzn.
						// ze budu muset nejak v mappings predavat ten ref na parenta
						let vl = pair[0].trim();
						let vr = pair[1].trim();

						(mappings[pair[0].trim()] = mappings[pair[0].trim()] || []).push([[...addr], ['hidden'], 'DATA_IF']);
					}

					if (name == 'data-tagname') {
						(mappings[val] = mappings[val] || []).push([[...addr], ['tagName'], 'CHANGE_TAGNAME']);
					}
					
					// conditional attributes
					if (name == 'data-attrs') {
						let pairs = val.split(';'),
							tmp, attr, mapping;
						for (const pair of pairs) {
							tmp = pair.split(':').map(v => v.trim());
							attr = tmp[0];
							mapping = tmp[1];
							(mappings[mapping] = mappings[mapping] || []).push([[...addr], [attr], 'IDENTITY']);
						}
					}
					
					if (name == 'data-innerhtml') {
						(mappings[val] = mappings[val] || []).push([[...addr], ['innerHTML'], 'IDENTITY']);
					}

					// navesit zbyle attributy
					if ((m = val.match(re)) && name != 'value' && name != 'checked') {
						(mappings[m[1]] = mappings[m[1]] || []).push([[...addr], ['attributes', name, 'value'], 'IDENTITY']);
					}
					if (name == 'data-foreach') {
						(mappings[val] = mappings[val] || []).push([[...addr], ['nodeValue'], 'IDENTITY']);
						// musime zastavit prochazeni do hloubky protoze to neni nas byz ted

						parseChildren = false;
					}
				}
				for (const attr of attrsToRemove) {
					node.removeAttribute(attr);
				}
			}
			
			if ((nl = node.childNodes.length) && parseChildren) {
				addr.push(CHILD_NODES, nl - 1);
			} else {
				while (addr[addr.length-1] == 0) {
					addr.pop();
					addr.pop();
				}

				addr[addr.length - 1] -= 1;
			}
			
			if (parseChildren) {
				stack.push(...node.childNodes);
			} else {
				parseChildren = true;
			}
		}

		return {
			DOMRef: $tmpl,
			isTmpl: isTmpl,
			mappings: mappings,
			bindings: bindings,
			events: events
		};
	}

	// prevent zpetnou vazbu u content editable
	function updateDOMNode(node, props, fn, value, oldValue, vm) {
		if (props[0] == 'tagName') {
			const oldNode = node;
			node = bindingFns[fn](value, node);
			vm.rebindSubs(oldNode, node);
			// nejak prepsat bindings this.node u subscriptions
		} else {
			let nodeProp = node,
				i = 0;
			for (; i < (props.length - 1); i++) {
				nodeProp = nodeProp[props[i]];
			}
			nodeProp[props[i]] = bindingFns[fn](value, node);
		}
	}

	function render(tmpl, data, events) {
		const $clone = tmpl.isTmpl ? document.importNode(tmpl.DOMRef, true) : tmpl.DOMRef;
		const res = {};

		for (const key in tmpl.mappings) {
			if (data[key] instanceof ObservableArray) {
				// zpracovavame vnorene pole ve viewmodelu
				// tzn. na prvku kam se ma vykreslit zpracujeme
				// template jednoho prvku
				// a vykreslime ho
				let subTmpl;
				for (const mapping of tmpl.mappings[key]) {
					const addr = mapping[0];
					let node = $clone;
					for (let i = 0; i < addr.length; i++) {
						node = node[addr[i]];
					}
					subTmpl = document.createElement('template');
					document.head.appendChild(subTmpl);
					subTmpl.content.appendChild(node.children[0]);
					renderArray(node, initTmpl(subTmpl, true), data[key], events);
				}
				continue;
			}
		
			let addr, props, fn, nodeProp;
			for (const mapping of tmpl.mappings[key]) {
				// subscribujeme
				// ale napred musime zjistit u kteryho VM na kterej klic
				// klice v mappings muzou byt jako '_parent.lang'
				let vm = data,
					lastKey = key;
				let vmref = key.split('.');
				if (vmref.length > 1) {
					lastKey = vmref.pop();
					for (const r of vmref) {
						vm = vm[r];
					}
				}
			
				let node = $clone;
				addr = mapping[0];
				props = mapping[1];
				fn = mapping[2];
				for (let i = 0; i < addr.length; i++) {
					node = node[addr[i]];
				}
				
				if (props[0] == 'tagName') {
					node = bindingFns[fn](vm[lastKey], node);
				} else {
					nodeProp = node;
					let i = 0
					for (; i < (props.length - 1); i++) {
						nodeProp = nodeProp[props[i]];
					}
					nodeProp[props[i]] = bindingFns[fn](vm[lastKey], node, props, vm);			
				}

				vm.subscribeDOM(lastKey, node, props, fn);
			}
		}
		
		// TODO: zmenti format tech bindingu
		for (const key in tmpl.bindings) {
			for (const binding of tmpl.bindings[key]) {
				for (const ev in binding) {
					let node = $clone,
						addr = binding[ev],
						prop = addr[addr.length-1];
					for (let i = 0; i < (addr.length - 1);i++) {
						node = node[addr[i]];
					}
					if (ev === 'input' && node.nodeName !== 'INPUT') {
						node.addEventListener(ev, e => data[key] = e.target.innerText);
					}
					
					// TODO: vymyslet jak modifikovat inputy checkboxy
					// protoze ty se modifikujou pres .checked a ne pres value
					// takze asi neco jako vzit si adresu toho nodu a z koncove
					if (node.nodeName === 'INPUT') {
						node.addEventListener(ev, e => data[key] = e.target[prop]);
					}
				}
			}
		}
		
		for (const key in tmpl.events) {
			for (const binding of tmpl.events[key]) {
				let node = $clone;
					ev = binding[0],
					addr = binding[1];
				for (const ptr of addr) {
					node = node[ptr];
				}
				if (key in events) {
					node.addEventListener(ev, events[key].bind(undefined, data));
				}
			}
		}
		
		return $clone;
	}
	
	class Observable {
		constructor(data, parent) {
			this._parent = parent;
			this._data = {};
			this._subs = {};
			this._subsDOM = {};
			this._refs = [];
			this._parentRefWrapper = this.$parent ? new ParentRefWrapper(this.$parent, this) : undefined;
			this._setup = true;

			for (const key in data) {
				this._data[key] = data[key];
				this._subs[key] = [];
				// magie pro trackovani zavislosti v computed Observable
				if (typeof data[key] === "function") {
					this._data[key] = data[key](this);
					let vm = this;
					console.log(this._refs);
					for (const ref of this._refs) {
						
						// zatim umime pouze parenta, nemuzeme
						// sousedy, otazka jestli vubec je to potreba
						if (ref === '_parent') {
							vm = vm.$parent;
						} else {
						// taky je problem jak to pak unsubscribovat
						// pri odjebani prvku
							//console.log(vm);
							vm.subscribe(ref, this, this.updateComputed(key, data[key]));
							vm = this;
						}
					};
					this._refs = [];
				};
				
				if (Array.isArray(data[key])) {
					this._data[key] = new ObservableArray(data[key], this);
				}
				
				Object.defineProperty(this, key, {
					set: v => {
						const o = this._data[key];
						this._data[key] = v;
						this.update(key, v, o);
					},
					get: () => {
						if (this._setup) {
							this._refs.push(key);
						}
						return this._data[key];
					}
				});
			}
			this._setup = false;
			delete this._parentRefWrapper;
		}
		
		set _parent(v) {
			this.$parent = v;
		}
		
		get _parent() {
			//console.log('getting parent', this);
			if (this._setup) {
				this._refs.push('_parent');
				return this._parentRefWrapper;
			}
			return this.$parent;
		}
		
		// TODO: need refactor - unsubs
		updateComputed(key, callback) {
			return () => this[key] = callback(this);
		}
		
		subscribe(key, obj, callback) {
			(this._subs[key] = this._subs[key] || []).push([obj, callback]);
		}
		
		unsubscribe(obj) {
			for (const key in this._subs) {
				this._subs[key] = this._subs[key].filter(sub => sub[0] !== obj);
			}
		}
		
		subscribeDOM(key, node, prop, fn) {
			(this._subsDOM[key] = this._subsDOM[key] || []).push([node, prop, fn]);
		}
		
		rebindSubs(oldNode, newNode) {
			for (const key in this._subsDOM) {
				for (const sub of this._subsDOM[key]) {
					if (sub[0] === oldNode) {
						sub[0] = newNode;
					}
				}
			}
		}

		update(key, value, oldVal) {
			if (key in this._subsDOM) {
				for (const sub of this._subsDOM[key]) {
					updateDOMNode(...sub, value, oldVal, this);
				}
			}
			for (const pair of this._subs[key]) {
				pair[1](value, oldVal, this);
			}
		}
	}
	
	class ParentRefWrapper {
		constructor(parentObj, child) {
			this.parentObj = parentObj;
			this.child = child;
			
			for (const key in parentObj._data) {
				Object.defineProperty(this, key, {
					set: v => {
						// tohle nevim jako jestli se nekdy pouzije
						this.parentObj._data[key] = v;
					},
					get: () => {
						this.child._refs.push(key);
						return this.parentObj._data[key];
					}
				});
			}
		}
	}
	
	class ObservableArray {
		constructor(data, parent) {
			this._parent = parent;
			this._items = [];
			this._index = 0;
			this._subs = {
				push: [],
				insertAt: [],
				remove: [],
				all: []
			};

			for (let i = 0; i < data.length; i++) {
				this._items.push(new Observable(data[i], this._parent));
				
				this._defProp(i);
			}
		}
		
		[Symbol.iterator]() {
			return {
				next: () => {
					if (this._index < this._items.length) {
						return {
							value: this._items[this._index++],
							done: false
						};
					} else {
						this._index = 0;
						return { done: true };
					}
				}
			};
		}
	
		// TODO reduce memory footprint, mozna hodne tech bindovanych listeneru
		subscribe(action, obj, callback) {
			(this._subs[action] = this._subs[action] || []).push([obj, callback]);
		}
		
		_notify(action, ...data) {
			for (const pair of this._subs[action]) {
				pair[1](...data);
			}
			for (const pair of this._subs.all) {
				pair[1](action, ...data);
			}
		}
		
		_defProp(i) {
			// akorat nevim jak udelat to abych kdyz chcu na novem indexu
			// vytvorit dalsi prvek, zatim musim nove prvky pridavat
			// pouze pres push nebo insertAt
			Object.defineProperty(this, i, {
				get: () => this._items[i],
				set: v => {
					this.remove(i);
					this.insertAt(i, v);
				},
				configurable: true
			});
		}
		
		get length() {
			return this._items.length;
		}
		
		push(item) {
			const vm = new Observable(item, this._parent);
			this._items.push(vm);
			this._notify('push', vm);
			this._defProp(this._items.length-1);
		}
		
		indexOf(item) {
			return this._items.indexOf(item)
		}
		
		insertAt(index, item) {
			const vm = new Observable(item, this._parent);
			this._items.splice(index, 0, vm);
			this._notify('insertAt', index, vm);
			this._defProp(this._items.length-1);
		}
		
		move(from, to) {
			// TODO: udelat 
		}
		
		remove(index) {
			// unsubs TODO:need refactor
			this._parent.unsubscribe(this._items[index]);
			this._items.splice(index, 1);
			this._notify('remove', index);
			delete this[this._items.length];
		}
		
		sortBy(column, asc) {
			// z povahy veci nemaji itemy zanorene klice
		}
		
		filter(callback) {}
	}
	
	// TODO: predelat na funkci misto classy, protoze stejne musim bindovat
	// tak je to uplne jedno ze je to objekt
	// nebo to vyresit tak aby to slo bez bindovani
	// TODO udelat wrapper nad wrappery abych mohl delat multidimenzionalni pole
	// TODO probublavat subscriby zvrchu dolu
	class DOMArrayWrapper {
		constructor(root, tmpl, vm, events) {
			this._DOMRef = root;
			this._tmpl = tmpl;
			this._events = events;
		
			const frag = document.createDocumentFragment();
			for (const item of vm) {
				frag.appendChild(render(tmpl, item, events));
			}
			
			root.appendChild(frag);
			vm.subscribe('insertAt', this, this.insertAt.bind(this));
			vm.subscribe('push', this ,this.push.bind(this));
			vm.subscribe('remove', this, this.remove.bind(this));
		}
		
		// TODO: celkove udelat optimizace na pridavani hodne velkyho
		// mnozstvi pres getAnimationFrame()
		
		insertAt(index, item) {
			const node = render(this._tmpl, item);
			this._DOMRef.insertBefore(node, this._DOMRef.children[index]);
		}
		
		push(node) {
			this._DOMRef.appendChild(render(this._tmpl, node, this._events));
		}
		
		remove(index) {
			this._DOMRef.removeChild(this._DOMRef.children[index]);
		}
		
		sort() {
			// tady by mela byt nejaka optimizacni vec, jakoze se pozastavi
			// kresleni nad domem, veci se propisujou do fragmentu
			// kterej se na konci sortu prida do domu
		}
	}
	
	function viewModel(data) {
		if (Array.isArray(data)) {
			return new ObservableArray(data);
		} else {
			return new Observable(data);
		}
	}
	
	function renderArray(target, tmpl, data, events) {
		return new DOMArrayWrapper(target, tmpl, data, events);
	}

	return {
		initTmpl: initTmpl,
		render: render,
		Observable: Observable,
		ObservableArray: ObservableArray,
		DOMArrayWrapper: DOMArrayWrapper,
		viewModel: viewModel,
		renderArray: renderArray
	};
})();
