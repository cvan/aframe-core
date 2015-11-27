/* global HTMLElement */
var re = require('../a-register-element');
var registerElement = re.registerElement;
var isNode = re.isNode;

var AComponents = require('./components').components;
var ANode = require('./a-node');
var debug = require('../utils/debug');
var THREE = require('../../lib/three');
var utils = require('../utils');

var log = debug('core:a-entity');
var error = debug('core:a-entity:error');

/**
 * Entity element definition.
 * Entities represent all elements that are part of the scene, and always have
 * a position, rotation, and scale.
 * In the entity-component system, entities are just a container of components.
 *
 * For convenience of inheriting components, the scene element inherits from
 * this prototype. When necessary, it differentiates itself by setting
 * `this.isScene`.
 *
 * @namespace Entity
 * @member {object} components - entity's currently initialized components.
 * @member {object} object3D - three.js object.
 * @member {array} states
 */
var proto = {
  defaults: {
    value: {
      position: '',
      rotation: '',
      scale: '',
      visible: ''
    }
  },

  createdCallback: {
    value: function () {
      this.states = [];
      this.components = {};
      this.object3D = new THREE.Mesh();
    }
  },

  attributeChangedCallback: {
    value: function (attr, oldVal, newVal) {
      this.setEntityAttribute(attr, oldVal, newVal);
    }
  },

  attachedCallback: {
    value: function () {
      this.addToParent();
      this.load();
    }
  },

  /**
   * Tell parent to remove this element's object3D from its object3D.
   * Do not call on scene element because that will cause a call to
   * document.body.remove().
   */
  detachedCallback: {
    value: function () {
      if (!this.parentEl || this.isScene) { return; }
      this.parentEl.remove(this);
    }
  },

  applyMixin: {
    value: function (attr) {
      var attrValue = this.getAttribute(attr);
      if (!attr) {
        this.updateComponents();
        return;
      }
      this.updateComponent(attr, attrValue);
    }
  },

  mapStateMixins: {
    value: function (state, op) {
      var mixins = this.getAttribute('mixin');
      var mixinIds;
      if (!mixins) { return; }
      mixinIds = mixins.split(' ');
      mixinIds.forEach(function (id) {
        var mixinId = id + '-' + state;
        op(mixinId);
      });
      this.updateComponents();
    }
  },

  updateStateMixins: {
    value: function (newMixins, oldMixins) {
      var self = this;
      oldMixins = oldMixins || '';
      var newMixinsIds = newMixins.split(' ');
      var oldMixinsIds = oldMixins ? oldMixins.split(' ') : [];
      // The list of mixins that might have been removed on update
      var diff = oldMixinsIds.filter(function (i) { return newMixinsIds.indexOf(i) < 0; });
      // Remove the mixins that are gone on update
      diff.forEach(function (mixinId) {
        var forEach = Array.prototype.forEach;
        // State Mixins
        var stateMixinsEls = document.querySelectorAll('[id^=' + mixinId + '-]');
        var stateMixinIds = [];
        forEach.call(stateMixinsEls, function (el) { stateMixinIds.push(el.id); });
        stateMixinIds.forEach(self.unregisterMixin.bind(self));
      });
      this.states.forEach(function (state) {
        newMixinsIds.forEach(function (id) {
          var mixinId = id + '-' + state;
          self.registerMixin(mixinId);
        });
      });
    }
  },

  add: {
    value: function (el) {
      if (!el.object3D) {
        error("Trying to add an object3D that doesn't exist");
      }
      this.object3D.add(el.object3D);
    }
  },

  addToParent: {
    value: function () {
      var self = this;
      var parent = this.parentEl = this.parentNode;
      var attachedToParent = this.attachedToParent;
      if (!parent || attachedToParent) { return; }
      if (isNode(parent)) {
        attach();
        return;
      }
      // If the parent isn't an `ANode` but eventually it will be
      // when a templated element is created, we want to attach
      // this element to the parent then.
      parent.addEventListener('nodeready', attach);
      function attach () {
        // To prevent an object to attach itself multiple times to the parent.
        self.attachedToParent = true;
        parent.add(self);
      }
    }
  },

  load: {
    value: function () {
      // To prevent calling load more than once
      if (this.hasLoaded) { return; }
      // Handle to the associated DOM element
      this.object3D.el = this;
      // It attaches itself to the threejs parent object3D
      this.addToParent();
      // Components initialization
      this.updateComponents();
      // Call the parent class
      ANode.prototype.load.call(this);
    },
    writable: window.debug
  },

  remove: {
    value: function (el) {
      this.object3D.remove(el.object3D);
    }
  },

  /**
   * Check if a component is defined for an entity, including defaults and mixins.
   *
   * @param {string} name - Component name.
   */
  isComponentDefined: {
    value: function (name) {
      // If the defaults contain the component
      var inDefaults = this.defaults[name];
      // If the element contains the component
      var inAttribute = this.hasAttribute(name);
      if (inDefaults !== undefined || inAttribute) { return true; }
      return this.isComponentMixedIn(name);
    }
  },

  isComponentMixedIn: {
    value: function (name) {
      var i;
      var inMixin = false;
      var mixinEls = this.mixinEls;
     // If any of the mixins contains the component
      for (i = 0; i < mixinEls.length; ++i) {
        inMixin = mixinEls[i].hasAttribute(name);
        if (inMixin) { break; }
      }
      return inMixin;
    }
  },

  initComponent: {
    value: function (name, isDependency) {
      // If it's not a component name or
      // If the component is already initialized
      if (!AComponents[name] || this.components[name]) { return; }
      // If the component is not defined for the element
      if (!this.isComponentDefined(name) && !isDependency) { return; }
      this.initComponentDependencies(name);
      if (isDependency) {
        // If it's a component dependency the component won't be part
        // of the element attributes so we have to add it.
        this.setAttribute(name, '');
      } else {
        this.components[name] = new AComponents[name].Component(this);
      }
      log('Component initialized: %s', name);
    }
  },

  initComponentDependencies: {
    value: function (name) {
      var self = this;
      var component = AComponents[name];
      var dependencies;
      // If the component doesn't exist
      if (!component) { return; }
      dependencies = AComponents[name].dependencies;
      if (!dependencies) { return; }
      dependencies.forEach(function (component) {
        self.initComponent(component, true);
      });
    }
  },

  updateComponents: {
    value: function () {
      var self = this;
      var components = Object.keys(AComponents);
      // Updates components
      components.forEach(updateComponent);
      function updateComponent (name) {
        var elValue = self.getAttribute(name);
        self.updateComponent(name, elValue);
      }
    }
  },

  /**
   * Initialize, update, or remove a single component.
   *
   * When initializing, we set the component on `this.components`.
   *
   * @param {string} name - Component name.
   * @param {object} newData - The new attributes assigned to the component
   */
  updateComponent: {
    value: function (name, newData) {
      var component = this.components[name];
      var isDefault = name in this.defaults;
      var isMixedIn = this.isComponentMixedIn(name);
      if (component) {
        // Attribute was removed. Remove component.
        // 1. If the component is not defined in the defaults,
        // mixins or element attribute
        // 2. If the new data is null, it's not a default
        // component and the component it's not defined via
        // mixins
        if (!this.isComponentDefined(name) ||
            newData === null && !isDefault && !isMixedIn) {
          component.remove();
          delete this.components[name];
          return;
        }
        if (typeof newData === 'string') {
          newData = component.parse(newData);
        }
        // Component already initialized. Update component.
        // TODO: update component attribute more granularly.
        component.updateAttributes(newData);
        return;
      }
      // Component not yet initialized. Initialize component.
      this.initComponent(name);
    }
  },

  removeAttribute: {
    value: function (attr) {
      var component = AComponents[attr];
      if (component) { this.setEntityAttribute(attr, undefined, null); }
      HTMLElement.prototype.removeAttribute.call(this, attr);
    }
  },

  /**
   * Deals with updates on entity-specific attributes (i.e., components and mixins).
   *
   * @param {string} attr
   * @param {string} oldVal
   * @param {string|object} newVal
   */
  setEntityAttribute: {
    value: function (attr, oldVal, newVal) {
      var component = AComponents[attr];
      oldVal = oldVal || this.getAttribute(attr);
      // When creating objects programatically and setting attributes, the object is not part
      // of the scene until is inserted into the DOM.
      if (!this.hasLoaded) { return; }
      if (attr === 'mixin') {
        this.updateStateMixins(newVal, oldVal);
        this.updateComponents();
        return;
      }
      if (component) { this.updateComponent(attr, newVal); }
    }
  },

  /**
   * If attribute is a component, setAttribute will apply the value to the
   * existing component data, not replace it. Examples:
   *
   * Examples:
   *
   * setAttribute('id', 'my-element');
   * setAttribute('material', { color: 'crimson' });
   * setAttribute('material', 'color', 'crimson');
   *
   * @param {string} attr - Attribute name. setAttribute will initialize or update
   *        a component if the name corresponds to a registered component.
   * @param {string|object} value - If a string, setAttribute will update the attribute or.
   *        component. If an object, the value will be mixed into the component.
   * @param {string} componentAttrValue - If defined, `value` will act as the attribute
   *        name and setAttribute will only set a single component attribute.
   */
  setAttribute: {
    value: function (attr, value, componentAttrValue) {
      var self = this;
      var component = AComponents[attr];
      var partialComponentData;
      var valueStr = value;

      if (component) {
        partialComponentData = self.getAttribute(attr) || {};
        if (typeof value === 'object') {
          // Update currently-defined component data with the object.
          value = utils.extend({}, partialComponentData, value);
        } else if (typeof value === 'string' && componentAttrValue !== undefined) {
          // Update currently-defined component data with the new attribute value.
          partialComponentData[value] = componentAttrValue;
          value = partialComponentData;
        }
        valueStr = component.stringify(value);
      }

      ANode.prototype.setAttribute.call(self, attr, valueStr);
      self.setEntityAttribute(attr, undefined, value);
    }
  },

  /**
   * If `attr` is a component, returns JUST the component data specified in the HTML
   * by parsing the style-like string into an object. Like a partial version of
   * `getComputedAttribute` as returned component data does not include applied mixins or
   * defaults.
   *
   * If `attr` is not a component, fall back to HTML getAttribute.
   *
   * @param {string} attr
   * @returns {object|string} Object if component, else string.
   */
  getAttribute: {
    value: function (attr) {
      var component = AComponents[attr];
      var value = HTMLElement.prototype.getAttribute.call(this, attr);
      if (!component || typeof value !== 'string') { return value; }
      return component.parse(value);
    }
  },

  /**
   * If `attr` is a component, returns ALL component data including applied mixins and
   * defaults.
   *
   * If `attr` is not a component, fall back to HTML getAttribute.
   *
   * @param {string} attr
   * @returns {object|string} Object if component, else string.
   */
  getComputedAttribute: {
    value: function (attr) {
      var component = this.components[attr];
      if (component) { return component.getData(); }
      return HTMLElement.prototype.getAttribute.call(this, attr);
    }
  },

  addState: {
    value: function (state) {
      if (this.is(state)) { return; }
      this.states.push(state);
      this.mapStateMixins(state, this.registerMixin.bind(this));
      this.emit('stateadded', {state: state});
    }
  },

  removeState: {
    value: function (state) {
      var stateIndex = this.is(state);
      if (stateIndex === false) { return; }
      this.states.splice(stateIndex, 1);
      this.mapStateMixins(state, this.unregisterMixin.bind(this));
      this.emit('stateremoved', {state: state});
    }
  },

  /**
   * Checks if the element is in a given state. e.g. el.is('alive');
   * @type {string} state - Name of the state we want to check
   */
  is: {
    value: function (state) {
      var is = false;
      this.states.forEach(function (elState, index) {
        if (elState === state) { is = index; }
      });
      return is;
    }
  }
};

module.exports = registerElement('a-entity', {
  prototype: Object.create(ANode.prototype, proto)
});