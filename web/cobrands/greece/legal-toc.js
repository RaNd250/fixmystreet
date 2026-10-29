/*
 * A row of links to the sections (h2 with an id) at the top of the long text pages: about, terms, privacy.
 */
(function() {
    'use strict';
    function setUp() {
        if (!document.body.classList.contains('gr-terms')) { return; }
        var heads = document.querySelectorAll('.content h2[id]');
        if (heads.length < 3) { return; }
        var en = (document.documentElement.lang || '').indexOf('en') === 0;
        var nav = document.createElement('nav');
        nav.className = 'gr-toc-wrap';
        nav.setAttribute('aria-label', en ? 'Contents' : 'Περιεχόμενα');
        var ul = document.createElement('ul');
        ul.className = 'gr-toc';
        Array.prototype.forEach.call(heads, function(h) {
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = '#' + h.id;
            a.textContent = h.textContent.replace(/^\s*\d+\.\s*/, '');
            li.appendChild(a);
            ul.appendChild(li);
        });
        nav.appendChild(ul);
        heads[0].parentNode.insertBefore(nav, heads[0]);
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', setUp); } else { setUp(); }
})();
