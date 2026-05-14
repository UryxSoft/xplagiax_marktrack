
// Custom Image Blot to handle resizing and alignment
// This ensures that width, height, and alignment classes are preserved in the Quill Delta

const Image = Quill.import('formats/image');

class CustomImage extends Image {
    static create(value) {
        const node = super.create(value);

        // If value is an object (from delta), apply attributes
        if (typeof value === 'object') {
            node.setAttribute('src', value.src);
            if (value.width) node.setAttribute('width', value.width);
            if (value.height) node.setAttribute('height', value.height);
            if (value.style) node.setAttribute('style', value.style);
            if (value.class) node.className = value.class;
            if (value.alt) node.setAttribute('alt', value.alt);
        }
        // If value is just a string (url), standard create
        return node;
    }

    static value(node) {
        return {
            src: node.getAttribute('src'),
            width: node.getAttribute('width') || node.style.width,
            height: node.getAttribute('height') || node.style.height,
            style: node.getAttribute('style'),
            class: node.className,
            alt: node.getAttribute('alt')
        };
    }

    format(name, value) {
        if (!value) {
            super.format(name, value);
            return;
        }

        const valStr = String(value);
        if (name === 'width') {
            this.domNode.setAttribute('width', valStr);
            this.domNode.style.width = valStr + (valStr.endsWith('%') || valStr.endsWith('px') ? '' : 'px');
        } else if (name === 'height') {
            this.domNode.setAttribute('height', valStr);
            this.domNode.style.height = valStr + (valStr.endsWith('%') || valStr.endsWith('px') ? '' : 'px');
        } else if (name === 'style') {
            this.domNode.setAttribute('style', valStr);
        } else if (name === 'class' || name === 'align') {
            // specific alignment classes
            if (value === 'left') {
                this.domNode.className = 'align-left';
            } else if (value === 'right') {
                this.domNode.className = 'align-right';
            } else if (value === 'center') {
                this.domNode.className = 'align-center';
            } else if (value) {
                this.domNode.className = value;
            } else {
                this.domNode.removeAttribute('class');
            }
        } else {
            super.format(name, value);
        }
    }
}

CustomImage.blotName = 'image';
CustomImage.tagName = 'IMG';

// Register nicely
window.CustomImageBlot = CustomImage;
console.log('[CustomImageBlot] Defined. Call Quill.register(CustomImageBlot, true) to use.');
