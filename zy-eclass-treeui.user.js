// ==UserScript==
// @name         延河课堂 课程树状导航
// @namespace    zy-eclass-treeui
// @version      0.4.1
// @description  Moodle 风格树状导航（魂兮归来！）
// @author       digua
// @match        https://zy-eclass.bit.edu.cn/course/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    width: 272,
    // body 最小宽度 1080，再窄就改成浮层覆盖，避免把页面撑出横向滚动条
    pushBreakpoint: 1080 + 272 + 16,
    cacheTtl: 5 * 60 * 1000,
    interactionLimit: 30,
    // true：课件/作业/测试 既出现在章节树里，也作为独立分组列出（与顶部 tab 一一对应）
    // false：只出现在章节树里，未挂章节的才用分组兜底
    typeGroups: true,
  };

  const match = location.pathname.match(/^\/course\/(\d+)(?:\/(.*))?$/);
  if (!match) return;
  const courseId = match[1];
  const pathParts = (match[2] || '').split('/').filter(Boolean);
  const section = pathParts[0] || 'content';
  // 全屏阅读器有自己的排版，先不接管
  if (pathParts[1] === 'full-screen') return;

  const TYPE = {
    material: { label: '资料', icon: '📄' },
    page: { label: '页面', icon: '📃' },
    online_video: { label: '视频', icon: '🎬' },
    slide: { label: '微课', icon: '🎬' },
    homework: { label: '作业', icon: '📝' },
    exam: { label: '测试', icon: '🧪' },
    forum: { label: '讨论', icon: '💬' },
    questionnaire: { label: '问卷', icon: '📊' },
    interaction: { label: '互动', icon: '✋' },
    classroom: { label: '课堂', icon: '✋' },
    select_student: { label: '选人', icon: '✋' },
    select_group: { label: '选组', icon: '✋' },
    race_answer: { label: '抢答', icon: '⚡' },
    web_link: { label: '链接', icon: '🔗' },
  };
  const typeInfo = (t) => TYPE[t] || { label: t || '活动', icon: '•' };

  // ---------------------------------------------------------------- utils

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  };

  const writeJSON = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* ignore quota errors */
    }
  };

  const api = async (path) => {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  };

  const safeApi = (path) => api(path).catch(() => null);

  const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.id ?? 0) - (b.id ?? 0);

  const courseUrl = (sub) => `/course/${courseId}/${sub}`;

  const activityUrl = (activity) => {
    if (activity.type === 'exam') return courseUrl(`learning-activity#/exam/${activity.id}`);
    return courseUrl(`learning-activity#/${activity.id}`);
  };

  // ---------------------------------------------------------------- data

  const CACHE_KEY = `zy-tree:cache:${courseId}`;

  // 章节树由三份接口拼出来（站点自己也是这么干的）：
  //   modules?include=syllabuses -> 模块/小节标题
  //   activities?sub_course_id=0 -> 已挂章节的课件/页面/作业（带 module_id、syllabus_id）
  //   exams                      -> 测试（同样带位置）
  async function loadData() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.at < CONFIG.cacheTtl) return cached.data;
    } catch (e) {
      /* ignore */
    }

    const [modules, activities, exams] = await Promise.all([
      safeApi(`/api/courses/${courseId}/modules?include=syllabuses`),
      safeApi(`/api/courses/${courseId}/activities?sub_course_id=0`),
      safeApi(`/api/courses/${courseId}/exams`),
    ]);

    const data = {
      modules: modules?.modules || [],
      activities: activities?.activities || [],
      exams: exams?.exams || [],
      extras: null,
    };
    saveCache(data);
    return data;
  }

  function saveCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
    } catch (e) {
      /* ignore quota errors */
    }
  }

  async function loadExtras() {
    const [bulletins, interactions, groupSets, corrections, notes, forums, questionnaires] =
      await Promise.all([
        safeApi(`/api/courses/${courseId}/bulletins`),
        safeApi(`/api/courses/${courseId}/interactions`),
        safeApi(`/api/courses/${courseId}/group-sets?preload_id=0`),
        safeApi(`/api/courses/${courseId}/correction-books?page=1&page_size=100&conditions={}`),
        safeApi(
          `/api/courses/${courseId}/notes?page=1&page_size=50&conditions=${encodeURIComponent(
            JSON.stringify({ activity_ids: [], keyword: '' })
          )}`
        ),
        safeApi(`/api/courses/${courseId}/topic-categories?page=1&page_size=50`),
        safeApi(`/api/courses/${courseId}/questionnaire-list?page=1&page_size=50&reloadPage=true`),
      ]);

    if ([bulletins, interactions, groupSets, corrections, notes, forums, questionnaires].every((r) => r === null)) {
      return null;
    }

    return {
      bulletins: bulletins?.bulletins || [],
      interactions: interactions?.interactions || [],
      groupSets: groupSets?.group_sets || [],
      corrections: corrections?.correction_books || [],
      notes: notes?.notes || [],
      forums: forums?.topic_categories || [],
      questionnaires: questionnaires?.questionnaires || [],
    };
  }

  // ---------------------------------------------------------------- model

  // 根节点顺序与顶部 tab 保持一致（章节在最前，作为结构视图）
  const SECTION_ORDER = [
    'bulletin',
    'courseware',
    'homework',
    'exam',
    'forum',
    'questionnaire',
    'classroom',
    'group-set',
    'note',
    'notebook',
  ];

  const COURSEWARE_TYPES = new Set(['material', 'page', 'online_video', 'slide', 'web_link']);

  function buildModel(data, extras) {
    const items = [
      ...data.activities.map((a) => ({ ...a, kind: 'activity' })),
      ...data.exams.map((a) => ({ ...a, kind: 'exam' })),
    ];

    const syllabusItems = new Map();
    const moduleItems = new Map();
    const syllabusIds = new Set();
    const moduleIds = new Set();
    const moduleOrder = new Map();

    data.modules
      .slice()
      .sort(bySort)
      .forEach((mod, index) => {
        moduleIds.add(mod.id);
        moduleOrder.set(mod.id, index);
        moduleItems.set(mod.id, []);
        for (const syl of mod.syllabuses || []) {
          syllabusIds.add(syl.id);
          syllabusItems.set(syl.id, []);
        }
      });

    const placedKeys = new Set();
    const keyOf = (item) => `${item.kind}:${item.id}`;
    for (const item of items) {
      if (item.syllabus_id && syllabusIds.has(item.syllabus_id)) {
        syllabusItems.get(item.syllabus_id).push(item);
        placedKeys.add(keyOf(item));
      } else if (item.module_id && moduleIds.has(item.module_id)) {
        moduleItems.get(item.module_id).push(item);
        placedKeys.add(keyOf(item));
      }
    }

    const itemOrder = (a, b) => {
      const am = moduleOrder.has(a.module_id) ? moduleOrder.get(a.module_id) : 999;
      const bm = moduleOrder.has(b.module_id) ? moduleOrder.get(b.module_id) : 999;
      return am - bm || bySort(a, b);
    };

    const groups = new Map();

    if (data.modules.length) {
      const moduleNodes = data.modules
        .slice()
        .sort(bySort)
        .map((mod) => {
          const sylNodes = (mod.syllabuses || [])
            .slice()
            .sort(bySort)
            .filter((syl) => (syllabusItems.get(syl.id) || []).length)
            .map((syl) => ({
              key: `s:${syl.id}`,
              label: syl.summary || `小节 ${syl.id}`,
              icon: '🔖',
              children: (syllabusItems.get(syl.id) || []).slice().sort(bySort).map(activityNode),
            }));
          const own = (moduleItems.get(mod.id) || []).slice().sort(bySort).map(activityNode);
          return {
            key: `m:${mod.id}`,
            label: mod.name || `第 ${mod.sort + 1} 章`,
            icon: '📚',
            children: [...own, ...sylNodes],
            empty: !own.length && !sylNodes.length,
            url: `${courseUrl('content')}?zyModule=${mod.id}`,
          };
        });
      groups.set('chapters', {
        key: 'g:chapters',
        label: '章节',
        icon: '📖',
        children: moduleNodes,
        open: true,
      });
    }

    const typeGroups = [
      { section: 'courseware', label: '课件', icon: '📄', match: (t) => COURSEWARE_TYPES.has(t) },
      { section: 'homework', label: '作业', icon: '📝', match: (t) => t === 'homework' },
      { section: 'exam', label: '测试', icon: '🧪', match: (t) => t === 'exam' },
    ];
    for (const group of typeGroups) {
      const list = items
        .filter((item) => group.match(item.type) && (CONFIG.typeGroups || !placedKeys.has(keyOf(item))))
        .sort(itemOrder);
      if (!list.length) continue;
      groups.set(group.section, {
        key: `g:${group.section}`,
        label: group.label,
        icon: group.icon,
        count: list.length,
        children: list.map(activityNode),
      });
    }

    if (extras) {
      if (extras.bulletins.length) {
        groups.set('bulletin', {
          key: 'g:bulletin',
          label: '公告',
          icon: '📢',
          count: extras.bulletins.length,
          children: extras.bulletins.map((b) => ({
            key: `b:${b.id}`,
            label: b.title || '(无标题公告)',
            icon: '📢',
            url: `${courseUrl('bulletin')}?zyBulletin=${b.id}`,
          })),
        });
      }
      if (extras.forums.length) {
        groups.set('forum', {
          key: 'g:forum',
          label: '讨论',
          icon: '💬',
          count: extras.forums.length,
          children: extras.forums.map((t) => ({
            key: `f:${t.id}`,
            label: t.title || t.name || `讨论 ${t.id}`,
            icon: '💬',
            url: courseUrl('forum'),
          })),
        });
      }
      if (extras.questionnaires.length) {
        groups.set('questionnaire', {
          key: 'g:questionnaire',
          label: '问卷',
          icon: '📊',
          count: extras.questionnaires.length,
          children: extras.questionnaires.map((q) => ({
            key: `q:${q.id}`,
            label: q.title || q.name || `问卷 ${q.id}`,
            icon: '📊',
            url: courseUrl('questionnaire'),
          })),
        });
      }
      if (extras.interactions.length) {
        groups.set('classroom', {
          key: 'g:classroom',
          label: '互动',
          icon: '✋',
          count: extras.interactions.length,
          children: extras.interactions.slice(0, CONFIG.interactionLimit).map((it) => ({
            key: `i:${it.id}`,
            label: `${typeInfo(it.type).label} · ${formatTime(it.created_at || it.title)}`,
            icon: typeInfo(it.type).icon,
            url: courseUrl('classroom'),
          })),
        });
      }
      if (extras.groupSets.length) {
        groups.set('group-set', {
          key: 'g:group-set',
          label: '分组学习',
          icon: '👥',
          count: extras.groupSets.length,
          children: extras.groupSets.map((g) => ({
            key: `gs:${g.id}`,
            label: `${g.name || '分组'}${g.group_count ? `（${g.group_count} 组）` : ''}`,
            icon: '👥',
            url: courseUrl('group-set'),
          })),
        });
      }
      if (extras.corrections.length) {
        groups.set('notebook', {
          key: 'g:notebook',
          label: '练习本',
          icon: '📕',
          count: extras.corrections.length,
          children: extras.corrections.map((c) => ({
            key: `c:${c.id}`,
            label: `${c.activity?.title || c.description || `练习 ${c.id}`}${
              c.attempt_accuracy != null ? `（${Math.round(c.attempt_accuracy * 100)}%）` : ''
            }`,
            icon: '📕',
            url: courseUrl('notebook'),
          })),
        });
      }
      if (extras.notes.length) {
        groups.set('note', {
          key: 'g:note',
          label: '笔记',
          icon: '🗒️',
          count: extras.notes.length,
          children: extras.notes.map((n) => ({
            key: `n:${n.id}`,
            label: n.title || `笔记 ${n.id}`,
            icon: '🗒️',
            url: courseUrl('note'),
          })),
        });
      }
    }

    const roots = [];
    if (groups.has('chapters')) roots.push(groups.get('chapters'));
    for (const sectionKey of SECTION_ORDER) {
      const group = groups.get(sectionKey);
      if (group) roots.push(group);
    }
    if (roots.length === 1 && roots[0].children) roots[0].open = true;

    return { modules: data.modules.length, roots };
  }

  function activityNode(item) {
    const info = typeInfo(item.type);
    return {
      key: `a:${item.kind}:${item.id}`,
      label: item.title || `活动 ${item.id}`,
      icon: info.icon,
      url: activityUrl(item),
      activityId: item.id,
    };
  }

  function formatTime(value) {
    if (!value) return '';
    const text = String(value);
    const m = text.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (m) return `${m[2]}.${m[3]} ${m[4]}:${m[5]}`;
    return text;
  }

  // ---------------------------------------------------------------- state

  const collapsed = new Set(readJSON('zy-tree:collapsed', []));
  const uiState = readJSON('zy-tree:ui', { hidden: null });

  function isCollapsed(node) {
    return node.open ? collapsed.has(node.key) : !collapsed.has(`!${node.key}`);
  }

  function toggleNode(node) {
    if (node.open) {
      if (collapsed.has(node.key)) collapsed.delete(node.key);
      else collapsed.add(node.key);
    } else if (collapsed.has(`!${node.key}`)) {
      collapsed.delete(`!${node.key}`);
    } else {
      collapsed.add(`!${node.key}`);
    }
    writeJSON('zy-tree:collapsed', [...collapsed]);
  }

  // ---------------------------------------------------------------- view

  let treeEl;
  let bodyEl;
  let currentActivityId = null;

  const currentSection = section;
  // 这些 tab 的内容本身就是挂在章节下的，高亮「章节」而不是某个独立分组
  const CHAPTER_SECTIONS = new Set(['content', 'learning-activity']);

  function currentActivity() {
    const h = location.hash || '';
    const exam = h.match(/#\/exam\/(\d+)/);
    if (exam) return Number(exam[1]);
    const plain = h.match(/#\/(\d+)/);
    if (plain) return Number(plain[1]);
    return null;
  }

  function renderCourseHeader() {
    const head = el('div', 'zy-tree-course');

    // 浮层模式下抽屉会盖住页面左上角的「返回」和课程名，这里让抽屉自带一份
    const back = el('a', 'zy-tree-back', '← 我的课程');
    back.href = '/user/courses';
    head.appendChild(back);

    const name = document.title.split(' - ')[0] || '课程';
    const title = el('a', 'zy-tree-course-name', name);
    title.href = courseUrl('content');
    title.title = name;
    head.appendChild(title);

    bodyEl.appendChild(head);
  }

  function renderNode(node, depth) {
    const wrap = el('div', 'zy-tree-item');
    const hasChildren = !!(node.children && node.children.length);
    const row = el(hasChildren || !node.url ? 'div' : 'a', 'zy-tree-row');
    row.style.paddingLeft = `${8 + depth * 14}px`;

    if (!hasChildren && node.url) row.href = node.url;
    if (!hasChildren && !node.url) row.classList.add('zy-tree-static');

    const caret = el('span', 'zy-tree-caret', hasChildren ? (isCollapsed(node) ? '▸' : '▾') : '');
    row.appendChild(caret);

    const icon = el('span', 'zy-tree-icon', node.icon || '•');
    row.appendChild(icon);

    const label = el('span', 'zy-tree-label', node.label);
    row.appendChild(label);

    if (node.count) row.appendChild(el('span', 'zy-tree-count', String(node.count)));
    if (node.empty) row.classList.add('zy-tree-empty');

    if (!hasChildren) {
      if (node.activityId && node.activityId === currentActivityId) row.classList.add('zy-tree-cur');
    } else if (
      !node.activityId &&
      ((node.key === `g:${currentSection}`) ||
        (node.key === 'g:chapters' && CHAPTER_SECTIONS.has(currentSection)))
    ) {
      row.classList.add('zy-tree-cur-group');
    }

    if (hasChildren) {
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-expanded', String(!isCollapsed(node)));
      const toggle = (ev) => {
        ev.preventDefault();
        toggleNode(node);
        renderTree();
        const again = bodyEl?.querySelector(`[data-key="${node.key}"]`);
        again?.focus();
      };
      row.dataset.key = node.key;
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') toggle(ev);
      });
    }

    wrap.appendChild(row);

    if (hasChildren && !isCollapsed(node)) {
      const kids = el('div', 'zy-tree-children');
      for (const child of node.children) kids.appendChild(renderNode(child, depth + 1));
      wrap.appendChild(kids);
    }
    return wrap;
  }

  let model = null;

  function renderTree() {
    if (!bodyEl || !model) return;
    const scrollTop = bodyEl.scrollTop;
    bodyEl.textContent = '';
    renderCourseHeader();
    if (!model.roots.length) {
      bodyEl.appendChild(el('div', 'zy-tree-empty-tip', '该课程暂无可见内容'));
    }
    for (const node of model.roots) bodyEl.appendChild(renderNode(node, 0));
    bodyEl.appendChild(renderCredit());
    bodyEl.scrollTop = scrollTop;
  }

  const CREDIT_TEXT = 'made with ♥️ by 🍠 & 🐋';

  // 和普通条目同样的行结构：占位箭头 + 图标 + 文本，只是不可点、不换行高亮
  function renderCredit() {
    const row = el('div', 'zy-tree-row zy-tree-static zy-tree-credit-row');
    row.style.paddingLeft = '8px';
    row.appendChild(el('span', 'zy-tree-caret', ''));
    row.appendChild(el('span', 'zy-tree-icon', 'ℹ️'));
    row.appendChild(el('span', 'zy-tree-label', CREDIT_TEXT));
    return row;
  }

  function expandPathToCurrent() {
    if (!model) return;
    const expand = (node) => {
      if (node.open) collapsed.delete(node.key);
      else collapsed.add(`!${node.key}`);
    };
    const walk = (node, trail) => {
      let hit = false;
      for (const child of node.children || []) {
        if (walk(child, [...trail, node])) hit = true;
      }
      if (node.activityId && node.activityId === currentActivityId) hit = true;
      if (hit) trail.forEach(expand);
      return hit;
    };
    if (currentActivityId) {
      for (const root of model.roots) walk(root, []);
    } else if (currentSection) {
      for (const root of model.roots) {
        if (root.key === `g:${currentSection}`) expand(root);
      }
    }
    writeJSON('zy-tree:collapsed', [...collapsed]);
  }

  function scrollToCurrent() {
    const cur = bodyEl?.querySelector('.zy-tree-cur, .zy-tree-cur-group');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- shell

  function mount() {
    if (document.getElementById('zy-tree')) return;
    const aside = el('aside', 'zy-tree');
    aside.id = 'zy-tree';

    const head = el('div', 'zy-tree-head');
    const brand = el('div', 'zy-tree-brand');
    brand.appendChild(el('span', 'zy-tree-brand-dot'));
    brand.appendChild(el('span', 'zy-tree-brand-text', '乐学导航'));
    head.appendChild(brand);

    const close = el('button', 'zy-tree-collapse', '«');
    close.type = 'button';
    close.title = '收起导航';
    close.addEventListener('click', () => setHidden(true));
    head.appendChild(close);

    bodyEl = el('div', 'zy-tree-body');
    bodyEl.appendChild(el('div', 'zy-tree-loading', '加载中…'));

    aside.appendChild(head);
    aside.appendChild(bodyEl);
    document.body.appendChild(aside);

    const fab = el('button', 'zy-tree-fab', '☰');
    fab.type = 'button';
    fab.title = '展开乐学导航';
    fab.addEventListener('click', () => setHidden(false));
    document.body.appendChild(fab);
    treeEl = aside;

    currentActivityId = currentActivity();
    applyLayout();
  }

  let narrowOpen = false;

  function isNarrow() {
    return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < CONFIG.pushBreakpoint;
  }

  function isHidden() {
    return isNarrow() ? !narrowOpen : !!uiState.hidden;
  }

  function setHidden(hidden) {
    if (isNarrow()) {
      narrowOpen = !hidden;
    } else {
      uiState.hidden = hidden;
      writeJSON('zy-tree:ui', uiState);
    }
    applyLayout();
  }

  function syncViewport() {
    if (!treeEl) return;
    const vv = window.visualViewport;
    const height = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    treeEl.style.setProperty('--zy-tree-vh', `${Math.round(height)}px`);
    treeEl.style.setProperty('--zy-tree-vt', `${Math.round(top)}px`);
  }

  function applyLayout() {
    if (!treeEl) return;
    syncViewport();
    const narrow = isNarrow();
    const hidden = isHidden();
    treeEl.classList.toggle('zy-tree-hidden', hidden);
    treeEl.classList.toggle('zy-tree-overlay', narrow);
    document.documentElement.classList.toggle('zy-tree-push', !narrow && !hidden);
  }

  // ---------------------------------------------------------------- deep links

  function focusModule(moduleId) {
    let tries = 0;
    const timer = setInterval(() => {
      const target = document.getElementById(`module-${moduleId}`);
      if (target) {
        clearInterval(timer);
        if (!target.classList.contains('expanded')) {
          target.querySelector('.module-summary')?.click();
        }
        target.scrollIntoView({ block: 'start' });
        flashNode(target);
        setTimeout(() => {
          const again = document.getElementById(`module-${moduleId}`);
          if (again) {
            again.scrollIntoView({ block: 'start' });
            flashNode(again);
          }
        }, 700);
      } else if (++tries > 24) {
        clearInterval(timer);
      }
    }, 250);
  }

  function flashNode(node) {
    node.classList.add('zy-tree-flash');
    setTimeout(() => node.classList.remove('zy-tree-flash'), 2600);
  }

  function focusBulletin(bulletinId) {
    const highlight = () => {
      for (const item of document.querySelectorAll('.bulletin')) {
        let scope = null;
        try {
          scope = window.angular?.element(item).scope();
        } catch (e) {
          scope = null;
        }
        if (!scope || !scope.bulletin) continue;
        if (String(scope.bulletin.id) !== String(bulletinId)) continue;
        if (!scope.isExpanded) {
          try {
            scope.$apply(() => {
              scope.isExpanded = true;
            });
          } catch (e) {
            item.click();
          }
        }
        item.scrollIntoView({ block: 'center' });
        flashNode(item);
        return true;
      }
      return false;
    };

    let tries = 0;
    const timer = setInterval(() => {
      if (highlight() || ++tries > 24) {
        clearInterval(timer);
        // Angular 数据到达后可能重建节点，再补一次定位与高亮
        setTimeout(highlight, 700);
      }
    }, 250);
  }

  function handleDeepLinks() {
    const params = new URLSearchParams(location.search);
    const bulletin = params.get('zyBulletin');
    if (bulletin) focusBulletin(bulletin);
    const moduleId = params.get('zyModule');
    if (moduleId) focusModule(moduleId);
  }

  // ---------------------------------------------------------------- boot

  async function init() {
    mount();
    handleDeepLinks();

    try {
      const data = await loadData();
      model = buildModel(data, data.extras);
      expandPathToCurrent();
      renderTree();

      if (!data.extras) {
        const extras = await loadExtras();
        data.extras = extras;
        saveCache(data);
        model = buildModel(data, extras);
        expandPathToCurrent();
        renderTree();
      }
      requestAnimationFrame(scrollToCurrent);
    } catch (e) {
      console.error('[zy-tree]', e);
      if (bodyEl) bodyEl.textContent = '导航加载失败';
    }

    window.addEventListener('hashchange', () => {
      const id = currentActivity();
      if (id === currentActivityId) return;
      currentActivityId = id;
      if (!model) return;
      expandPathToCurrent();
      renderTree();
      requestAnimationFrame(scrollToCurrent);
    });

    let resizeTimer = 0;
    const relayout = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyLayout, 120);
    };
    window.addEventListener('resize', relayout);
    window.visualViewport?.addEventListener('resize', relayout);
    window.visualViewport?.addEventListener('scroll', syncViewport);
  }

  const CSS = `
:root { --zy-tree-w: ${CONFIG.width}px; }
html.zy-tree-push body { padding-left: var(--zy-tree-w) !important; }

#zy-tree {
  position: fixed; top: 0; left: 0; bottom: 0; width: var(--zy-tree-w);
  display: flex; flex-direction: column;
  background: #fbfcfd; color: #24292f;
  border-right: 1px solid #e3e7ec;
  box-shadow: 2px 0 12px rgba(16, 24, 40, .06);
  z-index: 900;
  font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  transition: transform .18s ease;
}
#zy-tree.zy-tree-hidden { transform: translateX(-100%); }
#zy-tree.zy-tree-overlay {
  /* 手机/窄窗下站点的布局视口被 min-width 撑到 1080，bottom:0 会让抽屉高到屏幕外，
     这里改用 visualViewport 量出来的可视高度 */
  top: var(--zy-tree-vt, 0px);
  bottom: auto;
  height: var(--zy-tree-vh, 100vh);
  box-shadow: 2px 0 24px rgba(16, 24, 40, .18);
}

#zy-tree .zy-tree-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 10px 10px 14px; border-bottom: 1px solid #e9edf2; flex: 0 0 auto;
}
#zy-tree .zy-tree-brand { display: flex; align-items: center; gap: 8px; font-weight: 600; }
#zy-tree .zy-tree-brand-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #2f6feb; display: inline-block;
}
#zy-tree .zy-tree-brand-text { letter-spacing: .3px; }
#zy-tree .zy-tree-collapse {
  border: 1px solid #dfe4ea; background: #fff; color: #57606a; cursor: pointer;
  width: 24px; height: 24px; border-radius: 6px; line-height: 1; font-size: 13px; padding: 0;
}
#zy-tree .zy-tree-collapse:hover { background: #f1f4f8; }

#zy-tree .zy-tree-body { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: 8px 8px 28px; }
#zy-tree .zy-tree-loading { color: #8b949e; padding: 12px 8px; }
#zy-tree .zy-tree-empty-tip { color: #8b949e; padding: 10px 10px; font-size: 12px; }

#zy-tree .zy-tree-course { padding: 2px 8px 8px; }
#zy-tree .zy-tree-back {
  display: inline-block; margin: 0 0 2px; font-size: 12px; color: #6b7280;
  text-decoration: none; opacity: .85;
}
#zy-tree .zy-tree-back:hover { color: #2f6feb; opacity: 1; text-decoration: none; }
#zy-tree .zy-tree-course-name {
  display: block; font-weight: 600; font-size: 13px; color: #1f2328;
  text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#zy-tree .zy-tree-course-name:hover { color: #2f6feb; }

#zy-tree .zy-tree-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px 4px 8px; border-radius: 6px; cursor: pointer;
  color: #2f343d; text-decoration: none; user-select: none;
}
#zy-tree a.zy-tree-row:hover { background: #eef2f7; text-decoration: none; }
#zy-tree div.zy-tree-row:hover { background: #eef2f7; }
#zy-tree .zy-tree-row.zy-tree-cur { background: #e7effd; color: #1a56db; font-weight: 600; }
#zy-tree .zy-tree-row.zy-tree-cur-group { background: #f2f6fc; }
#zy-tree .zy-tree-row.zy-tree-empty { opacity: .55; }
#zy-tree .zy-tree-row.zy-tree-static { cursor: default; color: #8b949e; }
#zy-tree .zy-tree-row.zy-tree-static:hover { background: transparent; }
#zy-tree .zy-tree-credit-row { letter-spacing: .2px; }
@media (pointer: coarse) {
  #zy-tree .zy-tree-row { min-height: 34px; }
  #zy-tree .zy-tree-collapse { width: 30px; height: 30px; }
}
#zy-tree .zy-tree-caret { width: 12px; flex: 0 0 12px; color: #9aa4b2; font-size: 10px; text-align: center; }
#zy-tree .zy-tree-icon { flex: 0 0 auto; font-size: 12px; opacity: .9; }
#zy-tree .zy-tree-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#zy-tree .zy-tree-count {
  flex: 0 0 auto; min-width: 18px; text-align: center; font-size: 11px;
  color: #6b7280; background: #eef1f5; border-radius: 9px; padding: 0 6px;
}

body > .zy-tree-fab {
  position: fixed; left: 12px; bottom: 16px; z-index: 890;
  display: none;
  width: 40px; height: 40px; border-radius: 50%;
  border: 1px solid #e3e7ec; background: #fff; color: #2f6feb; cursor: pointer;
  box-shadow: 0 4px 14px rgba(16, 24, 40, .16); font-size: 16px; line-height: 1;
}
#zy-tree.zy-tree-hidden ~ .zy-tree-fab { display: block; }

@media (prefers-color-scheme: dark) {
  #zy-tree { background: #161b22; color: #d7dde5; border-right-color: #262d36; }
  #zy-tree .zy-tree-head { border-bottom-color: #262d36; }
  #zy-tree .zy-tree-collapse { background: #21262d; border-color: #30363d; color: #9aa4b2; }
  #zy-tree .zy-tree-row { color: #d7dde5; }
  #zy-tree a.zy-tree-row:hover, #zy-tree div.zy-tree-row:hover { background: #21262d; }
  #zy-tree .zy-tree-row.zy-tree-cur { background: #1c2c4d; color: #8ab4ff; }
  #zy-tree .zy-tree-row.zy-tree-cur-group { background: #1b222c; }
  #zy-tree .zy-tree-course-name { color: #e6edf3; }
  #zy-tree .zy-tree-back { color: #9aa4b2; }
  #zy-tree .zy-tree-count { background: #21262d; color: #9aa4b2; }
  body > .zy-tree-fab { background: #21262d; border-color: #30363d; color: #8ab4ff; }
}

.zy-tree-flash { animation: zy-tree-flash 2.2s ease; }
@keyframes zy-tree-flash {
  0%, 60% { box-shadow: 0 0 0 3px rgba(47, 111, 235, .35); }
  100% { box-shadow: 0 0 0 0 rgba(47, 111, 235, 0); }
}
`;

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  injectStyle();
  init();
})();
