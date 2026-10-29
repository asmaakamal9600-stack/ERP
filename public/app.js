
"use strict";

/* ==========================================
   System ABR
   Frontend interactions and server health
   ========================================== */

(() => {
  const sidebar = document.getElementById("sidebar");
  const menuToggle = document.getElementById("menu-toggle");

  const connectionStatus =
    document.getElementById("connection-status");

  const healthBadge =
    document.getElementById("health-badge");

  const healthIndicator =
    document.getElementById("health-indicator");

  const healthTitle =
    document.getElementById("health-title");

  const healthMessage =
    document.getElementById("health-message");

  const pageTitle =
    document.getElementById("page-title");

  const pageSubtitle =
    document.getElementById("page-subtitle");

  const moduleNotice =
    document.getElementById("module-notice");

  const navItems = document.querySelectorAll(
    ".nav-item[data-module]"
  );

  const moduleCards = document.querySelectorAll(
    ".module-card[data-module]"
  );

  const originalNotice = moduleNotice
    ? moduleNotice.textContent
    : "";

  const moduleInformation = {
    dashboard: {
      title: "لوحة التحكم",
      subtitle: "نظرة عامة على نظام إدارة أعمالك"
    },
    sales: {
      title: "المبيعات والفواتير",
      subtitle: "إدارة فواتير البيع والمدفوعات والمرتجعات"
    },
    purchases: {
      title: "المشتريات والمرتجعات",
      subtitle: "إدارة مشتريات المؤسسة وتكاليف الشراء"
    },
    inventory: {
      title: "المنتجات والمخزون",
      subtitle: "إدارة المنتجات والكميات وحركات المخزون"
    },
    parties: {
      title: "العملاء والموردون",
      subtitle: "إدارة بيانات العملاء والموردين"
    },
    finance: {
      title: "الحسابات والخزائن",
      subtitle: "إدارة الحسابات والتحصيل والتحويلات"
    },
    expenses: {
      title: "المصروفات والإيرادات",
      subtitle: "متابعة التدفقات المالية للمؤسسة"
    },
    reports: {
      title: "التقارير والأرباح",
      subtitle: "تقارير الأداء المالي والتشغيلي"
    },
    users: {
      title: "المستخدمون والصلاحيات",
      subtitle: "إدارة حسابات المستخدمين وصلاحيات الوصول"
    },
    audit: {
      title: "سجل العمليات",
      subtitle: "مراجعة العمليات المسجلة في النظام"
    },
    settings: {
      title: "إعدادات النظام",
      subtitle: "إعدادات المؤسسة والعملة والفواتير"
    }
  };

  function closeSidebar() {
    if (!sidebar || !menuToggle) {
      return;
    }

    sidebar.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "فتح القائمة");
  }

  function toggleSidebar() {
    if (!sidebar || !menuToggle) {
      return;
    }

    const isOpen = sidebar.classList.toggle("is-open");

    menuToggle.setAttribute(
      "aria-expanded",
      String(isOpen)
    );

    menuToggle.setAttribute(
      "aria-label",
      isOpen ? "إغلاق القائمة" : "فتح القائمة"
    );
  }

  if (menuToggle) {
    menuToggle.addEventListener("click", toggleSidebar);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  });

  function selectModule(moduleName) {
    const info = moduleInformation[moduleName];

    if (!info) {
      return;
    }

    navItems.forEach((item) => {
      const selected =
        item.dataset.module === moduleName;

      item.classList.toggle("active", selected);

      if (selected) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
    });

    if (pageTitle) {
      pageTitle.textContent = info.title;
    }

    if (pageSubtitle) {
      pageSubtitle.textContent = info.subtitle;
    }

    if (moduleNotice) {
      if (moduleName === "dashboard") {
        moduleNotice.textContent = originalNotice;
      } else {
        moduleNotice.textContent =
          "وحدة " + info.title +
          " لم يتم ربطها بعد بواجهات الخادم والصلاحيات " +
          "وقاعدة البيانات. لن يتم حفظ أي عملية من هذه الشاشة " +
          "قبل تنفيذ الربط والتحقق منه.";
      }
    }

    closeSidebar();

    /*
     * هذه الخطوة تغيّر عنوان الوحدة المعروضة فقط.
     * لا تنشئ فواتير ولا تغيّر المخزون ولا تحفظ بيانات.
     * ستُربط الوحدات لاحقًا بواجهات API فعلية.
     */
  }

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      selectModule(item.dataset.module);
    });
  });

  moduleCards.forEach((card) => {
    card.addEventListener("click", () => {
      selectModule(card.dataset.module);

      const mainContent =
        document.getElementById("main-content");

      if (mainContent) {
        mainContent.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });
  });

  function setConnectionState(state, message) {
    const states = {
      checking: {
        label: "جارٍ الفحص",
        title: "جارٍ التحقق من الاتصال",
        color: "var(--warning)"
      },
      connected: {
        label: "متصل",
        title: "استجاب الخادم بنجاح",
        color: "var(--success)"
      },
      disconnected: {
        label: "غير متصل",
        title: "تعذر تأكيد الاتصال",
        color: "var(--danger)"
      },
      unavailable: {
        label: "غير متاح",
        title: "خدمة الفحص غير متاحة",
        color: "var(--warning)"
      }
    };

    const current = states[state] || states.unavailable;

    if (connectionStatus) {
      connectionStatus.textContent = current.label;
      connectionStatus.style.color = current.color;
    }

    if (healthBadge) {
      healthBadge.textContent = current.label;
      healthBadge.style.color = current.color;
      healthBadge.style.borderColor = current.color;
    }

    if (healthIndicator) {
      healthIndicator.style.background = current.color;
    }

    if (healthTitle) {
      healthTitle.textContent = current.title;
    }

    if (healthMessage) {
      healthMessage.textContent = message;
    }
  }

  async function checkServerHealth() {
    setConnectionState(
      "checking",
      "جارٍ إرسال طلب فحص إلى الخادم."
    );

    try {
      const response = await fetch("/api/health", {
        method: "GET",
        headers: {
          "Accept": "application/json"
        },
        cache: "no-store",
        credentials: "same-origin"
      });

      if (!response.ok) {
        setConnectionState(
          "unavailable",
          "الخادم لم يُرجع استجابة ناجحة لفحص الحالة. " +
          "تحققي من نشر Worker ومسار /api/health."
        );
        return;
      }

      const result = await response.json();

      if (result && result.ok === true) {
        setConnectionState(
          "connected",
          "الخادم استجاب بنجاح. هذا الفحص وحده لا يثبت " +
          "أن تسجيل الدخول أو جميع وحدات النظام جاهزة."
        );
      } else {
        setConnectionState(
          "unavailable",
          "استجاب الخادم، لكن نتيجة الفحص لم تؤكد " +
          "جاهزية الخدمة وقاعدة البيانات."
        );
      }
    } catch (_error) {
      setConnectionState(
        "disconnected",
        "تعذر الوصول إلى الخادم. تأكدي من نشر المشروع " +
        "وصحة عنوان الموقع واتصال الإنترنت."
      );
    }
  }

  checkServerHealth();

  /*
   * لا تُحفظ بيانات مالية أو كلمات مرور في المتصفح.
   * ولا يُستخدم localStorage كقاعدة بيانات.
   */
})();
