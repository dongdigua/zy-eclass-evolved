// ==UserScript==
// @name         延河课堂优化：待办显示课程名 · 隐藏课程 · 修正返回链接 · 移动端按钮
// @namespace    https://zy-eclass.bit.edu.cn/
// @version      1.2.1
// @description  首页「待办事项」显示所属课程名称；「我的课程」默认隐藏指定关键字的课程（默认：大学物理实验），并在列表顶部提示隐藏数量；课程页左上角「返回」改回课程列表（原地址为站外域名）；修复手机竖屏下弹窗底部按钮（交作业「确认」）跑到屏幕外点不到的问题。想看被隐藏的课程时，在脚本管理器里禁用本脚本即可。
// @match        https://zy-eclass.bit.edu.cn/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ============================== 配置区 ============================== */
  const CONFIG = {
    // 首页 - 待办事项：在标题前显示所属课程
    todo: {
      enabled: true,
    },
    // 我的课程：默认隐藏某些课程
    courses: {
      enabled: true,
      // 课程名称包含以下任一关键字即隐藏（区分大小写，按需修改）
      hideKeywords: ['大学物理实验'],
      // 列表顶部的提示文案，{n} = 隐藏数量，{keywords} = 关键字
      notice: '已隐藏 {n} 门「{keywords}」课程',
    },
    // 课程页（章节/作业等子页面）左上角的「返回」：
    // 站点模板把它的地址硬编码成了站外的 AI 工作台，这里改回课程列表
    backLink: {
      enabled: true,
      // 优先用页面自带的 #courseListUrl 值，取不到时用这个
      fallbackUrl: '/user/courses',
    },
    // 移动端弹窗（如交作业时「选择附件」）：站点按 layout viewport 计算 100% 高度，
    // 手机竖屏下底部按钮会落到屏幕外且无法滚动到
    mobilePopup: {
      enabled: true,
      // 可视宽度不超过该值时启用（手机/窄屏）
      maxWidth: 820,
    },
  };
  /* =================================================================== */

  const TODO_CARD_SEL = '.latest-todo-list';
  const COURSE_LIST_SEL = 'ol.semester-list';
  const APPLY_DELAY = 120;

  const CSS = `
.zy-course-chip {
  flex: 0 0 auto;
  max-width: 55%;
  padding: 0 6px;
  border-radius: 9px;
  background-color: #e8f0fd;
  color: #2b6cb0;
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
${TODO_CARD_SEL} .todo-title.zy-has-course {
  display: flex;
  align-items: center;
  column-gap: 6px;
  min-height: 24px;
}
${TODO_CARD_SEL} .todo-title.zy-has-course .title-text {
  flex: 0 1 auto;
  min-width: 0;
  max-width: none;
}
${TODO_CARD_SEL} .todo-title.zy-has-course.zy-has-type {
  padding-right: 46px;
}
/* 站点把「作业/测试」角标做成了 left:auto 的绝对定位，会盖住标题开头（以及这里的课程标签），
   所以有课程标签时把它摆到右侧 */
${TODO_CARD_SEL} .todo-title.zy-has-course.zy-has-type .activity-type {
  left: auto;
  right: 0;
}
.zy-course-hidden {
  display: none !important;
}
.zy-hidden-notice {
  margin: 0 0 15px;
  padding: 8px 12px;
  border: 1px dashed #cbd5e1;
  border-radius: 4px;
  background-color: #f8fafc;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}
/* 移动端弹窗：把浮层限制在“可视区”而不是 layout viewport，
   并让主体区滚动、底部按钮常驻可见 */
.zy-mobile-popup.popup-area {
  width: var(--zy-vw) !important;
  height: var(--zy-vh) !important;
  left: var(--zy-vx, 0px) !important;
  top: var(--zy-vy, 0px) !important;
  overflow: auto !important;
}
.zy-mobile-popup > .popup-content {
  box-sizing: border-box !important;
  display: flex !important;
  flex-direction: column !important;
  height: auto !important;
  max-height: calc(var(--zy-vh) - 16px) !important;
  min-height: 0 !important;
  margin: 8px auto !important;
}
.zy-mobile-popup > .popup-content > .popup-header,
.zy-mobile-popup > .popup-content > .popup-footer {
  flex: 0 0 auto !important;
  position: relative;
}
/* 弹窗比屏幕宽时（如附件选择 900px），底部按钮组按可视宽度排布并拉长，
   这样不用横向拖动就能点到 */
.zy-mobile-popup > .popup-content > .popup-footer {
  width: min(100%, var(--zy-vw)) !important;
  box-sizing: border-box !important;
}
.zy-mobile-popup > .popup-content > .popup-footer .form-buttons {
  display: flex !important;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 8px !important;
  box-sizing: border-box;
}
.zy-mobile-popup > .popup-content > .popup-footer .form-buttons > .button,
.zy-mobile-popup > .popup-content > .popup-footer > .button {
  flex: 1 1 0 !important;
  width: calc(100% - 16px) !important;
  max-width: 220px !important;
  margin: 0 !important;
}
.zy-mobile-popup > .popup-content > .main-area {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  height: auto !important;
  max-height: none !important;
  overflow-y: auto !important;
  -webkit-overflow-scrolling: touch;
}
`;

  /* ============================== 工具函数 ============================== */

  function injectStyle() {
    if (document.getElementById('zy-enhancer-style')) return;
    const style = document.createElement('style');
    style.id = 'zy-enhancer-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // 该页面是 AngularJS 应用，数据挂在 scope 上（DOM 里只渲染了一部分字段）
  function scopeOf(el) {
    try {
      const ng = window.angular;
      return ng && ng.element ? ng.element(el).scope() : null;
    } catch (e) {
      return null;
    }
  }

  function setClass(el, name, on) {
    if (el.classList.contains(name) === on) return; // 避免无意义的 DOM 变更
    el.classList.toggle(name, on);
  }

  /* ========================= 1. 首页 - 待办事项 ========================= */

  function enhanceTodos() {
    const card = document.querySelector(TODO_CARD_SEL);
    if (!card) return;

    const cardScope = scopeOf(card);
    const todoList = cardScope && Array.isArray(cardScope.todoList) ? cardScope.todoList : [];

    card.querySelectorAll('.todo-list').forEach((item, index) => {
      if (item.dataset.zyTodo === 'done') return;

      const itemScope = scopeOf(item);
      const data = (itemScope && itemScope.todoData) || todoList[index] || null;
      const courseName = data && data.course_name ? String(data.course_name).trim() : '';
      if (!courseName) return;

      const title = item.querySelector('.todo-title');
      if (!title) return;

      const chip = document.createElement('span');
      chip.className = 'zy-course-chip';
      chip.textContent = courseName;
      chip.title = '课程：' + courseName;
      title.insertBefore(chip, title.firstChild);

      setClass(title, 'zy-has-course', true);
      setClass(title, 'zy-has-type', !!item.querySelector('.activity-type'));
      item.dataset.zyTodo = 'done';
    });
  }

  /* ========================= 2. 我的课程 - 隐藏课程 ========================= */

  function courseNameOf(item) {
    const scope = scopeOf(item);
    const course = scope && scope.course;
    if (course) {
      const name = course.display_name || course.name || course.second_name;
      if (name) return String(name).trim();
    }
    const el = item.querySelector('.course-name');
    return el ? el.textContent.trim() : '';
  }

  function isHiddenKeywordCourse(name) {
    if (!name) return false;
    return CONFIG.courses.hideKeywords.some((keyword) => keyword && name.includes(keyword));
  }

  function updateHiddenNotice(host, hiddenCount) {
    const container = host.parentElement;
    let notice = document.querySelector('.zy-hidden-notice');

    if (hiddenCount <= 0) {
      if (notice) notice.remove();
      return;
    }

    const text = CONFIG.courses.notice
      .replace('{n}', String(hiddenCount))
      .replace('{keywords}', CONFIG.courses.hideKeywords.join('、'));

    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'zy-hidden-notice';
      container.insertBefore(notice, host);
    } else if (notice.parentElement !== container) {
      container.insertBefore(notice, host);
    }
    if (notice.textContent !== text) notice.textContent = text;

    const tip = '仅统计当前页；如需查看这些课程，请在脚本管理器中禁用本脚本';
    if (notice.title !== tip) notice.title = tip;
  }

  function enhanceCourses() {
    const host = document.querySelector('.user-courses ' + COURSE_LIST_SEL);
    const notice = document.querySelector('.zy-hidden-notice');

    if (!host) {
      if (notice) notice.remove(); // 列表还没渲染/被过滤为空时不要留下孤立的提示
      return;
    }

    let hiddenCount = 0;

    host.querySelectorAll('li.course').forEach((item) => {
      const hidden = isHiddenKeywordCourse(courseNameOf(item));
      if (hidden) hiddenCount++;
      setClass(item, 'zy-course-hidden', hidden);
    });

    updateHiddenNotice(host, hiddenCount);
  }

  /* ===================== 3. 课程页「返回」链接 ===================== */

  // 站点把「返回」硬编码成了 https://aita.yanhekt.cn/... ，而页面里
  // #courseListUrl（服务端渲染）才是真正的课程列表地址
  function courseListUrl() {
    const input = document.getElementById('courseListUrl');
    const value = input && input.value ? input.value.trim() : '';
    // 只接受站内相对地址，避免再次跳到站外
    const isRelative = value && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('//');
    return isRelative ? value : CONFIG.backLink.fallbackUrl;
  }

  function enhanceBackLink() {
    const target = courseListUrl();
    document.querySelectorAll('a.go-back-link[href]').forEach((link) => {
      let host = null;
      try {
        host = new URL(link.getAttribute('href'), location.href).host;
      } catch (e) {
        host = null;
      }
      if (!host || host === location.host) return; // 站内（含相对地址）的一律不动
      if (link.getAttribute('href') === target) return;

      link.setAttribute('href', target);
      if (!link.title) link.title = '返回我的课程';
    });
  }

  /* ===================== 4. 移动端弹窗高度 ===================== */

  // 手机上 layout viewport 可以远大于可视区（本站 body 有 min-width: 1080px，
  // 而 .popup-area 是 position:fixed + height:100%，100% 算的是 layout viewport），
  // 于是弹窗按“屏幕外”的高度排版，底部的确认/提交按钮点不到。
  function visibleViewport() {
    const de = document.documentElement;
    const vv = window.visualViewport;
    const w = Math.min(de.clientWidth || window.innerWidth, vv ? Math.round(vv.width) : Infinity);
    const h = Math.min(de.clientHeight || window.innerHeight, vv ? Math.round(vv.height) : Infinity);
    return {
      w: w || window.innerWidth,
      h: h || window.innerHeight,
      x: vv ? Math.round(vv.offsetLeft) : 0,
      y: vv ? Math.round(vv.offsetTop) : 0,
    };
  }

  function enhanceMobilePopups() {
    const de = document.documentElement;
    const view = visibleViewport();
    // 只在真正出问题时才接管：弹窗按 layout viewport（100%）排版，
    // 而它比可视区高（手机上的典型情况）。桌面窗口即使窄，两者也基本一致。
    const layoutGap = window.innerHeight - de.clientHeight > 40;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const fitNeeded = layoutGap || (coarse && view.w <= CONFIG.mobilePopup.maxWidth);

    document.querySelectorAll('.popup-area').forEach((modal) => {
      const fit = CONFIG.mobilePopup.enabled && fitNeeded && modal.classList.contains('open');
      setClass(modal, 'zy-mobile-popup', fit);
      if (!fit) return;
      // 让浮层正好覆盖可视区（含视觉视口的偏移）
      modal.style.setProperty('--zy-vw', view.w + 'px');
      modal.style.setProperty('--zy-vh', view.h + 'px');
      modal.style.setProperty('--zy-vx', view.x + 'px');
      modal.style.setProperty('--zy-vy', view.y + 'px');
    });
  }

  /* ============================== 调度 ============================== */

  function applyAll() {
    injectStyle();
    if (CONFIG.todo.enabled) {
      try {
        enhanceTodos();
      } catch (e) {
        console.error('[zy-eclass-enhancer] 待办事项处理失败:', e);
      }
    }
    if (CONFIG.courses.enabled) {
      try {
        enhanceCourses();
      } catch (e) {
        console.error('[zy-eclass-enhancer] 课程列表处理失败:', e);
      }
    }
    if (CONFIG.backLink.enabled) {
      try {
        enhanceBackLink();
      } catch (e) {
        console.error('[zy-eclass-enhancer] 返回链接处理失败:', e);
      }
    }
    if (CONFIG.mobilePopup.enabled) {
      try {
        enhanceMobilePopups();
      } catch (e) {
        console.error('[zy-eclass-enhancer] 移动端弹窗处理失败:', e);
      }
    }
  }

  let scheduled = false;
  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      applyAll();
    }, APPLY_DELAY);
  }

  // Angular 会在筛选、翻页、展开时重建节点，所以持续监听 DOM 变化；
  // class 变化用于捕捉弹窗打开/关闭（站点给 .popup-area 加 .open）
  new MutationObserver(scheduleApply).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  window.addEventListener('resize', scheduleApply);
  window.addEventListener('orientationchange', scheduleApply);
  if (window.visualViewport) {
    // 手机浏览器地址栏收起/展开时可视高度会变化
    window.visualViewport.addEventListener('resize', scheduleApply);
  }

  applyAll();
  setTimeout(applyAll, 500);
  setTimeout(applyAll, 1500);
  window.addEventListener('load', applyAll);
})();
