const ko = (() => {
	// TODO: nejak udelat applyBindings nad uz vykreslenym DOMem
	// kvuli rychlejsimu nacitani a SSR
	// kvuli SSR by melo jit ty bindingy serializovat a poslat v jsonu
	// na klienta
	const CHILD_NODES = 'childNodes',
		IDENTITY = v => v,
		DATA_IF = (v, r) => !(v === r),
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
		};

	function initTmpl(id) {
		const $tmpl = document.getElementById(id).content,
			bindings = {},
			mappings = {},
			events = {},
			stack = [$tmpl],
			addr = [],
			re = /{{(.+)}}/;

		let node, nl, nv, name, val, m;
		while(stack.length) {
			node = stack.pop();
		
			if (nv = node.nodeValue) {
				if (m = nv.match(re)) {
					(mappings[m[1]] = mappings[m[1]] || []).push([[...addr], ['nodeValue'], IDENTITY]);
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
						(mappings[m[1]] = mappings[m[1]] || []).push([[...addr], ['value'], IDENTITY]);
					}

					if (name == 'checked' && (m = val.match(re))) {
						(bindings[m[1]] = bindings[m[1]] || []).push({change: [...addr, 'checked']});
						(mappings[m[1]] = mappings[m[1]] || []).push([[...addr], ['checked'], IDENTITY]);
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
						(mappings[val] = mappings[val] || []).push([[...addr], ['style', 'display'], DATA_HIDE]);
					}

					if (name == 'data-if') {
						let pair = val.split(':');
						(mappings[pair[0].trim()] = mappings[pair[0].trim()] || []).push([[...addr], ['hidden'], DATA_IF.bind(undefined, pair[1].trim())]);
					}

					if (name == 'data-tagname') {
						(mappings[val] = mappings[val] || []).push([[...addr], ['tagName'], CHANGE_TAGNAME]);
					}
					
					// conditional attributes
					if (name == 'data-attrs') {
						let pairs = val.split(';'),
							tmp, attr, mapping;
						for (const pair of pairs) {
							tmp = pair.split(':').map(v => v.trim());
							attr = tmp[0];
							mapping = tmp[1];
							(mappings[mapping] = mappings[mapping] || []).push([[...addr], [attr], IDENTITY]);
						}
					}

					// navesit zbyle attributy
					if ((m = val.match(re)) && name != 'value' && name != 'checked') {
						(mappings[m[1]] = mappings[m[1]] || []).push([[...addr], ['attributes', name, 'value'], IDENTITY]);
					}
					// nejak zpracovat attributy
				}
				for (const attr of attrsToRemove) {
					node.removeAttribute(attr);
				}
			}
			
			if (nl = node.childNodes.length) {
				addr.push(CHILD_NODES, nl - 1);
			} else {
				while (addr[addr.length-1] == 0) {
					addr.pop();
					addr.pop();
				}

				addr[addr.length - 1] -= 1;
			}
			
			stack.push(...node.childNodes);
		}

		return {
			DOMRef: $tmpl,
			mappings: mappings,
			bindings: bindings,
			events: events
		};
	}

	// prevent zpetnou vazbu u content editable
	function updateDOMNode(node, props, fn, value, oldValue, vm) {
		if (props[0] == 'tagName') {
			const oldNode = node;
			node = fn(value, node);
			vm.rebindSubs(oldNode, node);
			// nejak prepsat bindings this.node u subscriptions
		} else {
			let nodeProp = node,
				i = 0;
			for (; i < (props.length - 1); i++) {
				nodeProp = nodeProp[props[i]];
			}
			nodeProp[props[i]] = fn(value, node);
		}
	}

	function render(tmpl, data, events) {
		const $clone = document.importNode(tmpl.DOMRef, true);
		
		const res = {};

		for (const key in tmpl.mappings) {
			let addr, props, fn, nodeProp;
			for (const mapping of tmpl.mappings[key]) {
				let node = $clone;
				addr = mapping[0];
				props = mapping[1];
				fn = mapping[2];
				for (let i = 0; i < addr.length; i++) {
					node = node[addr[i]];
				}
				if (props[0] == 'tagName') {
					node = fn(data[key], node);
				} else {
					nodeProp = node;
					let i = 0
					for (; i < (props.length - 1); i++) {
						nodeProp = nodeProp[props[i]];
					}
					nodeProp[props[i]] = fn(data[key], node, props);
					
				}
				data.subscribeDOM(key, node, props, fn);
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
		constructor(data) {
			this._data = {};
			this._subs = {};
			this._subsDOM = {};
			this._refs = [];
			this._setup = true;

			for (const key in data) {
				this._data[key] = data[key];
				this._subs[key] = [];
				// magie pro trackovani zavislosti v computed Observable
				if (typeof data[key] === "function") {
					this._data[key] = data[key](this);
					for (const ref of this._refs) {
						this.subscribe(ref, this.updateComputed(key, data[key]));
					};
					this._refs = [];
				};
				
				Object.defineProperty(this, key, {
					set: v => {
						const o = this._data[key];
						//if (o != v) {
							this._data[key] = v;
							this.update(key, v, o);
						//}
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
		}
		
		updateComputed(key, callback) {
			return () => this[key] = callback(this._data);
		}
		
		subscribe(key, callback) {
			if (key in this._subs) {
				this._subs[key].push(callback);
			} else {
				this._subs[key] = [callback];
			}
		}
		
		subscribeDOM(key, node, prop, fn) {
			(this._subsDOM[key] = this._subsDOM[key] || []).push([node, prop, fn]);
		};
		
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
			this._subs[key].forEach(callback => callback(value, oldVal, this));
		}
	}
	
	class ObservableArray {
		constructor(data) {
			this._items = [];
			this._index = 0;
			this._subs = {
				push: [],
				insertAt: [],
				remove: [],
				all: []
			};

			for (let i = 0; i < data.length; i++) {
				this._items.push(new Observable(data[i]));
				
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
		subscribe(action, callback) {
			this._subs[action].push(callback);
		}
		
		_notify(action, ...data) {
			for (const clbck of this._subs[action]) {
				clbck(...data);
			}
			for (const clbck of this._subs.all) {
				clbck(action, ...data);
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
			const vm = new Observable(item);
			this._items.push(vm);
			this._notify('push', vm);
			this._defProp(this._items.length-1);
		}
		
		indexOf(item) {
			return this._items.indexOf(item)
		}
		
		insertAt(index, item) {
			const vm = new Observable(item);
			this._items.splice(index, 0, vm);
			this._notify('insertAt', index, vm);
			this._defProp(this._items.length-1);
		}
		
		move(from, to) {
			// TODO: udelat 
		}
		
		remove(index) {
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
			vm.subscribe('insertAt', this.insertAt.bind(this));
			vm.subscribe('push', this.push.bind(this));
			vm.subscribe('remove', this.remove.bind(this));
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
	
	function renderArray(targetId, tmpl, data, events) {
		return new DOMArrayWrapper(document.getElementById(targetId), tmpl, data, events);
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
