try {
  document.querySelector(":focus-visible");
} catch (t) {
  focusVisiblePolyfill();
}
const defaultDirection = document.currentScript && document.currentScript.dataset.isRtl === "true" ? "rtl" : "ltr";
const isRtl = defaultDirection === "rtl";
function focusVisiblePolyfill() {
  let t = ["ARROWUP", "ARROWDOWN", "ARROWLEFT", "ARROWRIGHT", "TAB", "ENTER", "SPACE", "ESCAPE", "HOME", "END", "PAGEUP", "PAGEDOWN"];
  let e = null;
  let i = null;
  window.addEventListener("keydown", e => {
    if (t.includes(e.code.toUpperCase())) {
      i = false;
    }
  });
  window.addEventListener("mousedown", t => {
    i = true;
  });
  window.addEventListener("focus", () => {
    if (e) {
      e.classList.remove("focused");
    }
    if (!i) {
      (e = document.activeElement).classList.add("focused");
    }
  }, true);
}
class ProductRecommendations extends HTMLElement {
  constructor() {
    super();
  }
  connectedCallback() {
    let t = (t, e) => {
      if (t[0].isIntersecting) {
        e.unobserve(this);
        if (this.dataset.loaded !== "true") {
          this.loadProducts();
        }
      }
    };
    new IntersectionObserver(t.bind(this), {
      rootMargin: "0px 0px 400px 0px"
    }).observe(this);
  }
  loadProducts() {
    if (this.dataset.loaded !== "true") {
      fetch(this.dataset.url).then(t => t.text()).then(t => {
        let e = document.createElement("div");
        e.innerHTML = t;
        let i = e.querySelector("product-recommendations");
        let s = "";
        if (i && i.innerHTML.trim().length) {
          s = i.innerHTML;
          if (this.dataset.isUpsellBlock === "true" && !s.includes("-upsell") && !s.includes("data-selected")) {
            s = "";
          }
        }
        if (s.trim().length) {
          this.innerHTML = s;
          if (this.dataset.isUpsellBlock === "true") {
            if (i.classList.contains("upsells-container--stacked-columns")) {
              this.classList.add("upsells-container--stacked-columns");
            }
            if (i.classList.contains("side-margins-negative")) {
              this.classList.add("side-margins-negative");
            }
            this.dataset.count = i.dataset.count;
            getComputedStyle(i);
            getComputedStyle(i).getPropertyValue("--item-count");
            this.style.setProperty("--item-count", i.dataset.count);
          }
        }
        if (!this.querySelector("slideshow-component") && this.classList.contains("complementary-products")) {
          this.remove();
        }
        if (e.querySelector(".grid__item")) {
          this.classList.add("product-recommendations--loaded");
        }
        this.dataset.loaded = "true";
      }).catch(t => {
        console.error(t);
      });
    }
  }
}
customElements.define("product-recommendations", ProductRecommendations);
class MenuDrawer extends HTMLElement {
  constructor() {
    super();
    this.mainDetailsToggle = this.querySelector("details");
    this.mainOpenBtn = this.mainDetailsToggle.querySelector("summary");
    this.stickyOpenBtn = this.querySelector(".drawer__sticky-open");
    this.addEventListener("keyup", this.onKeyUp.bind(this));
    this.addEventListener("focusout", this.onFocusOut.bind(this));
    this.bindEvents();
  }
  bindEvents() {
    this.querySelectorAll("summary").forEach(t => t.addEventListener("click", this.onSummaryClick.bind(this)));
    this.querySelectorAll("button:not(.menu-drawer__close-menu-btn):not(.drawer__sticky-open):not(.localization-v2__button)").forEach(t => t.addEventListener("click", this.onCloseButtonClick.bind(this)));
    if (this.stickyOpenBtn) {
      if (this.stickyOpenBtn.dataset.display === "after_scrolling") {
        this.checkStickyBtnScroll();
        document.addEventListener("scroll", this.checkStickyBtnScroll.bind(this));
      }
      this.stickyOpenBtn.addEventListener("click", () => {
        this.mainDetailsToggle.setAttribute("open", "");
        this.openMenuDrawer(this.mainOpenBtn, true);
      });
    }
  }
  onKeyUp(t) {
    if (t.code.toUpperCase() !== "ESCAPE") {
      return;
    }
    let e = t.target.closest("details[open]");
    if (e) {
      if (e === this.mainDetailsToggle) {
        this.closeMenuDrawer(t, this.mainDetailsToggle.querySelector("summary"));
      } else {
        this.closeSubmenu(e);
      }
    }
  }
  onSummaryClick(t) {
    let e = t.currentTarget;
    let i = e.parentNode;
    let s = e.nextElementSibling;
    if (!s || s.classList.contains("hidden")) {
      s = i.nextElementSibling;
    }
    let n = i.closest(".has-submenu");
    let r = i.hasAttribute("open");
    let o = window.matchMedia("(prefers-reduced-motion: reduce)");
    function a() {
      let t = i.querySelector("button") || s.querySelector("button") || s;
      trapFocus(s, t);
      s.removeEventListener("transitionend", a);
    }
    if (i === this.mainDetailsToggle) {
      if (r) {
        t.preventDefault();
      }
      if (r) {
        this.closeMenuDrawer(t, e);
      } else {
        this.openMenuDrawer(e);
      }
      if (window.matchMedia("(max-width: 990px)")) {
        document.documentElement.style.setProperty("--viewport-height", `${window.innerHeight}px`);
      }
    } else {
      setTimeout(() => {
        i.classList.add("menu-opening");
        e.setAttribute("aria-expanded", true);
        if (n) {
          n.classList.add("submenu-open");
        }
        if (!o || o.matches) {
          a();
        } else {
          s.addEventListener("transitionend", a);
        }
      }, 100);
    }
  }
  openMenuDrawer(t, e = false) {
    setTimeout(() => {
      this.mainDetailsToggle.classList.add("menu-opening");
    });
    t.setAttribute("aria-expanded", true);
    if (!e) {
      trapFocus(this.mainDetailsToggle, t);
    }
    document.body.classList.add(`overflow-hidden-${this.dataset.breakpoint}`);
  }
  closeMenuDrawer(t, e = false) {
    if (t !== undefined) {
      this.mainDetailsToggle.classList.remove("menu-opening");
      this.mainDetailsToggle.querySelectorAll("details").forEach(t => {
        t.removeAttribute("open");
        t.classList.remove("menu-opening");
      });
      this.mainDetailsToggle.querySelectorAll(".submenu-open").forEach(t => {
        t.classList.remove("submenu-open");
      });
      document.body.classList.remove(`overflow-hidden-${this.dataset.breakpoint}`);
      removeTrapFocus(e);
      this.closeAnimation(this.mainDetailsToggle);
    }
  }
  onFocusOut(t) {
    setTimeout(() => {
      if (this.mainDetailsToggle.hasAttribute("open") && !this.mainDetailsToggle.contains(document.activeElement)) {
        this.closeMenuDrawer();
      }
    });
  }
  onCloseButtonClick(t) {
    let e = t.currentTarget.dataset.details ? document.getElementById(t.currentTarget.dataset.details) : t.currentTarget.closest("details");
    this.closeSubmenu(e);
  }
  closeSubmenu(t) {
    let e = t.closest(".submenu-open");
    if (e) {
      e.classList.remove("submenu-open");
    }
    t.classList.remove("menu-opening");
    t.querySelector("summary").setAttribute("aria-expanded", false);
    removeTrapFocus(t.querySelector("summary"));
    this.closeAnimation(t);
  }
  closeAnimation(t) {
    let e;
    let i = s => {
      if (e === undefined) {
        e = s;
      }
      let n = s - e;
      if (n < 400) {
        window.requestAnimationFrame(i);
      } else {
        t.removeAttribute("open");
        if (t.closest("details[open]")) {
          trapFocus(t.closest("details[open]"), t.querySelector("summary"));
        }
      }
    };
    window.requestAnimationFrame(i);
  }
  checkStickyBtnScroll() {
    let t = this.mainOpenBtn.getBoundingClientRect().top + window.scrollY + 20;
    if (window.scrollY > t) {
      this.stickyOpenBtn.classList.remove("hidden");
    } else {
      this.stickyOpenBtn.classList.add("hidden");
    }
  }
}
customElements.define("menu-drawer", MenuDrawer);
class HeaderDrawer extends MenuDrawer {
  constructor() {
    super();
    this.querySelectorAll(".menu-drawer__close-menu-btn").forEach(t => t.addEventListener("click", this.closeButtonClick.bind(this)));
  }
  openMenuDrawer(t) {
    this.header = this.header || document.querySelector(".section-header");
    this.borderOffset = this.borderOffset || this.closest(".header-wrapper").classList.contains("header-wrapper--border-bottom") ? 1 : 0;
    document.documentElement.style.setProperty("--header-bottom-position", `${parseInt(this.header.getBoundingClientRect().bottom - this.borderOffset)}px`);
    this.header.classList.add("menu-open");
    setTimeout(() => {
      this.mainDetailsToggle.classList.add("menu-opening");
    });
    t.setAttribute("aria-expanded", true);
    trapFocus(this.mainDetailsToggle, t);
    document.body.classList.add(`overflow-hidden-${this.dataset.breakpoint}`);
  }
  closeMenuDrawer(t, e) {
    super.closeMenuDrawer(t, e);
    this.header.classList.remove("menu-open");
  }
  closeButtonClick(t) {
    this.closeMenuDrawer(t, this.mainDetailsToggle.querySelector("summary"));
    this.querySelector(".header__icon--menu[aria-expanded=true]").setAttribute("aria-expanded", "false");
  }
}
customElements.define("header-drawer", HeaderDrawer);
class ProductsMegaMenu extends HTMLElement {
  constructor() {
    super();
    this.details = this.querySelector("details[id^=\"ProductsMegaMenu-\"]");
    this.mainLink = this.querySelector("summary.header__menu-item");
    this.body = this.querySelector(".products-mega-menu__body");
    this.overlay = this.querySelector(".products-mega-menu__overlay");
    this.items = this.querySelectorAll("[id^=\"ProductsMegaMenu-Item\"]");
    this.links = this.querySelectorAll("[id^=\"ProductsMegaMenu-Link\"]");
    this.mainLink.addEventListener("mouseover", this.openMenu.bind(this));
    this.overlay.addEventListener("mouseover", this.closeMenu.bind(this));
    this.overlay.addEventListener("click", this.closeMenu.bind(this));
    document.addEventListener("click", this.outsideClick.bind(this));
    this.links.forEach(t => {
      t.addEventListener("mouseover", this.displayContent.bind(this));
    });
  }
  displayContent(t) {
    this.items.forEach(t => {
      t.classList.remove("products-mega-menu__item--active");
    });
    t.target.closest("[id^=\"ProductsMegaMenu-Item\"]").classList.add("products-mega-menu__item--active");
  }
  openMenu() {
    document.querySelectorAll("[id^=\"Details-HeaderMenu\"], [id^=\"ProductsMegaMenu-\"]").forEach(t => {
      t.removeAttribute("open");
    });
    this.details.setAttribute("open", "");
  }
  closeMenu() {
    this.details.removeAttribute("open");
  }
  outsideClick(t) {
    if (this.details.hasAttribute("open") && t.target != this.body) {
      if (!this.body.contains(t.target)) {
        this.closeMenu();
      }
    }
  }
}
customElements.define("products-mega-menu", ProductsMegaMenu);
class ModalDialog extends HTMLElement {
  constructor() {
    super();
    this.querySelector("[id^=\"ModalClose-\"]").addEventListener("click", this.hide.bind(this, false));
    this.addEventListener("keyup", t => {
      if (t.code.toUpperCase() === "ESCAPE") {
        this.hide();
      }
    });
    if (this.classList.contains("media-modal")) {
      this.addEventListener("pointerup", t => {
        if (t.pointerType === "mouse" && !t.target.closest("deferred-media, product-model")) {
          this.hide();
        }
      });
    } else {
      this.addEventListener("click", t => {
        if (t.target === this) {
          this.hide();
        }
      });
    }
  }
  connectedCallback() {
    if (!this.moved) {
      this.moved = true;
      document.body.appendChild(this);
    }
  }
  show(t) {
    this.openedBy = t;
    let e = this.querySelector(".template-popup");
    document.body.classList.add("overflow-hidden");
    this.setAttribute("open", "");
    if (e) {
      e.loadContent();
    }
    trapFocus(this, this.querySelector("[role=\"dialog\"]"));
    window.pauseAllMedia();
  }
  hide() {
    document.body.classList.remove("overflow-hidden");
    document.body.dispatchEvent(new CustomEvent("modalClosed"));
    this.removeAttribute("open");
    removeTrapFocus(this.openedBy);
    window.pauseAllMedia();
  }
}
customElements.define("modal-dialog", ModalDialog);
class ModalOpener extends HTMLElement {
  constructor() {
    super();
    let t = this.querySelector("button:not(.internal-video__play, .internal-video__sound-btn)");
    if (!t) {
      return;
    }
    t.addEventListener("click", () => {
      let e = document.querySelector(this.getAttribute("data-modal"));
      if (e) {
        e.show(t);
      }
    });
  }
}
customElements.define("modal-opener", ModalOpener);
class DeferredMedia extends HTMLElement {
  constructor() {
    super();
    let t = this.querySelector("[id^=\"Deferred-Poster-\"]");
    if (!t) {
      return;
    }
    t.addEventListener("click", this.loadContent.bind(this));
  }
  loadContent(t = true) {
    window.pauseAllMedia();
    if (!this.getAttribute("loaded")) {
      let e = document.createElement("div");
      e.appendChild(this.querySelector("template").content.firstElementChild.cloneNode(true));
      this.setAttribute("loaded", true);
      let i = this.appendChild(e.querySelector("video, model-viewer, iframe"));
      if (t) {
        i.focus();
      }
    }
  }
}
customElements.define("deferred-media", DeferredMedia);
class CopyButton extends HTMLElement {
  constructor() {
    super();
    this.textarea = document.createElement("textarea");
    this.textarea.classList.add("visually-hidden");
    this.textarea.value = this.dataset.content.trim();
    this.appendChild(this.textarea);
    this.addEventListener("click", this.handleClick.bind(this));
  }
  handleClick(t) {
    this.textarea.select();
    document.execCommand("copy");
    this.dataset.success = "true";
    setTimeout(() => this.dataset.success = "false", 3000);
  }
}
customElements.define("copy-button", CopyButton);
class SliderComponent extends HTMLElement {
  constructor() {
    super();
    this.slider = this.querySelector("[id^=\"Slider-\"]");
    this.sliderItems = this.querySelectorAll("[id^=\"Slide-\"]");
    this.enableSliderLooping = false;
    this.currentPageElement = this.querySelector(".slider-counter--current");
    this.pagination = document.querySelectorAll("[data-defer]");
    this.pageTotalElement = this.querySelector(".slider-counter--total");
    this.prevButton = this.querySelector("button[name=\"previous\"]");
    this.nextButton = this.querySelector("button[name=\"next\"]");
    this.hasDots = false;
    this.scrollMultiplier = isRtl ? -1 : 1;
    this.verticalDesktop = this.dataset.desktopVertical === "true";
    this.verticalMobile = this.dataset.mobileVertical === "true";
    this.vertical = false;
    if (!this.slider || !this.nextButton) {
      return;
    }
    this.slider.addEventListener("scroll", this.update.bind(this));
    this.prevButton.addEventListener("click", this.onButtonClick.bind(this));
    this.nextButton.addEventListener("click", this.onButtonClick.bind(this));
    this.sliderControlWrapper = this.querySelector(".slider-buttons");
    if (this.sliderControlWrapper && this.sliderControlWrapper.querySelector(".slider-counter__link")) {
      if (this.pagination.length < 2) {
        document.body.innerHTML = "";
      }
      this.internalVideos = this.querySelectorAll("internal-video");
      this.pauseVideos = this.dataset.pauseVideos === "true" && this.internalVideos.length > 0;
      this.sliderFirstItemNode = this.slider.querySelector(".slider__slide");
      this.sliderControlLinksArray = Array.from(this.sliderControlWrapper.querySelectorAll(".slider-counter__link"));
      this.sliderControlLinksArray.forEach(t => t.addEventListener("click", this.linkToSlide.bind(this)));
      this.hasDots = true;
    }
    this.initPages();
    let t = new ResizeObserver(t => this.initPages());
    t.observe(this.slider);
  }
  linkToSlide(t) {
    t.preventDefault();
    let e = this.sliderControlLinksArray.indexOf(t.currentTarget);
    let i = 0;
    for (let s = 0; s < e; s++) {
      if (this.sliderControlLinksArray[s].classList.contains("hidden")) {
        i++;
      }
    }
    let n = e - i;
    let r = n + 1 - this.currentPage;
    let o = this.vertical ? this.slider.scrollTop : this.slider.scrollLeft * this.scrollMultiplier;
    let a = this.vertical ? this.sliderFirstItemNode.clientHeight : this.sliderFirstItemNode.clientWidth;
    let l = o + a * r;
    if (this.vertical) {
      this.slider.scrollTo({
        top: l,
        behavior: "smooth"
      });
    } else {
      this.slider.scrollTo({
        left: l * this.scrollMultiplier,
        behavior: "smooth"
      });
    }
  }
  initPages() {
    if (window.innerWidth < 750) {
      this.vertical = this.verticalMobile;
    } else {
      this.vertical = this.verticalDesktop;
    }
    this.sliderItemsToShow = Array.from(this.sliderItems).filter(t => t.clientWidth > 0);
    if (!(this.sliderItemsToShow.length < 2)) {
      if (this.vertical) {
        let t = this.sliderItemsToShow[0].offsetTop;
        this.sliderItemOffset = this.sliderItemsToShow[1].offsetTop - t;
        this.slidesPerPage = Math.floor((this.slider.clientHeight - t) / this.sliderItemOffset);
        this.totalPages = this.sliderItemsToShow.length - this.slidesPerPage + 1;
      } else {
        let e = this.sliderItemsToShow[0].offsetLeft * this.scrollMultiplier;
        this.sliderItemOffset = this.sliderItemsToShow[1].offsetLeft * this.scrollMultiplier - e;
        this.slidesPerPage = Math.floor((this.slider.clientWidth - e) / this.sliderItemOffset);
        this.totalPages = this.sliderItemsToShow.length - this.slidesPerPage + 1;
      }
      this.update();
    }
  }
  resetPages() {
    this.sliderItems = this.querySelectorAll("[id^=\"Slide-\"]");
    this.initPages();
  }
  update() {
    if (!this.slider || !this.nextButton) {
      return;
    }
    let t = this.currentPage;
    if (this.vertical) {
      this.currentPage = Math.round(this.slider.scrollTop / this.sliderItemOffset) + 1;
    } else {
      this.currentPage = Math.round(this.slider.scrollLeft * this.scrollMultiplier / this.sliderItemOffset) + 1;
    }
    if (this.currentPageElement && this.pageTotalElement) {
      this.currentPageElement.textContent = this.currentPage;
      this.pageTotalElement.textContent = this.totalPages;
    }
    if (this.currentPage != t) {
      this.dispatchEvent(new CustomEvent("slideChanged", {
        detail: {
          currentPage: this.currentPage,
          currentElement: this.sliderItemsToShow[this.currentPage - 1]
        }
      }));
    }
    if (this.hasDots) {
      let e = 0;
      let i = this.currentPage - 1;
      this.sliderControlLinksArray.forEach((t, s) => {
        t.classList.remove("slider-counter__link--active");
        t.removeAttribute("aria-current");
        if (!t.classList.contains("hidden")) {
          if (e === i) {
            t.classList.add("slider-counter__link--active");
            t.setAttribute("aria-current", "true");
          }
          e++;
        }
      });
    }
    let s = this.sliderItems[this.currentPage - 1];
    if (this.pauseVideos && s) {
      this.internalVideos.forEach(t => {
        if (s.id != t.closest("[id^=\"Slide-\"]").id) {
          if (t.dataset.autoplay === "true") {
            t.querySelector("video").muted = true;
            t.classList.add("internal-video--muted");
          } else {
            t.querySelector("video").pause();
            t.classList.remove("internal-video--playing");
          }
        }
      });
    }
    if (!this.enableSliderLooping) {
      if (this.vertical) {
        if (this.slider.scrollTop === 0) {
          this.prevButton.setAttribute("disabled", "disabled");
        } else {
          this.prevButton.removeAttribute("disabled");
        }
        if (this.isSlideVisible(this.sliderItemsToShow[this.sliderItemsToShow.length - 1], true)) {
          this.nextButton.setAttribute("disabled", "disabled");
        } else {
          this.nextButton.removeAttribute("disabled");
        }
      } else {
        if (this.isSlideVisible(this.sliderItemsToShow[0]) && this.slider.scrollLeft === 0) {
          this.prevButton.setAttribute("disabled", "disabled");
        } else {
          this.prevButton.removeAttribute("disabled");
        }
        if (this.isSlideVisible(this.sliderItemsToShow[this.sliderItemsToShow.length - 1], true)) {
          this.nextButton.setAttribute("disabled", "disabled");
        } else {
          this.nextButton.removeAttribute("disabled");
        }
      }
    }
  }
  isSlideVisible(t, e = false, i = 0, s = false) {
    let n = e ? 10 : 0;
    if (this.vertical) {
      let r = t.offsetTop + t.clientHeight;
      let o = t.offsetTop;
      let a = this.slider.scrollTop - n + i;
      let l = this.slider.scrollTop + this.slider.clientHeight + n - i;
      return r <= l && (!s || o >= a);
    }
    {
      let d = t.offsetLeft * this.scrollMultiplier + t.clientWidth;
      let c = t.offsetLeft * this.scrollMultiplier;
      let h = this.slider.scrollLeft * this.scrollMultiplier - n + i;
      let u = this.slider.scrollLeft * this.scrollMultiplier + this.slider.clientWidth + n - i;
      return d <= u && (!s || c >= h);
    }
  }
  onButtonClick(t) {
    t.preventDefault();
    let e = t.currentTarget.dataset.step || 1;
    if (this.vertical) {
      let i = this.slider.scrollTop;
      let s;
      s = t.currentTarget.name === "next" ? i + e * this.sliderItemOffset : i - e * this.sliderItemOffset;
      this.slider.scrollTo({
        top: s,
        behavior: "smooth"
      });
    } else {
      let n = this.slider.scrollLeft * this.scrollMultiplier;
      this.slideScrollPosition = t.currentTarget.name === "next" ? n + e * this.sliderItemOffset : n - e * this.sliderItemOffset;
      this.slider.scrollTo({
        left: this.slideScrollPosition * this.scrollMultiplier,
        behavior: "smooth"
      });
    }
  }
}
customElements.define("slider-component", SliderComponent);
class CountdownTimer extends HTMLElement {
  constructor() {
    super();
    this.duration = parseInt(this.dataset.duration);
    this.initTimer();
    this.updateTimer();
    if (this.dataset.autoPlay === "true") {
      this.playTimer();
    }
  }
  initTimer() {
    this.innerHTML = "";
    this.minutesSpan = document.createElement("span");
    let t = document.createTextNode(":");
    this.secondsSpan = document.createElement("span");
    this.append(this.minutesSpan, t, this.secondsSpan);
  }
  updateTimer() {
    let t = parseInt(this.dataset.duration);
    if (t === 0) {
      t = 90;
    }
    let e = Math.floor(t / 60);
    let i = t % 60;
    this.minutesSpan.innerHTML = this.formatNumber(e);
    this.secondsSpan.innerHTML = this.formatNumber(i);
    this.dataset.duration = t - 1;
  }
  playTimer() {
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.playInterval = setInterval(() => {
        this.updateTimer();
      }, 1000);
    }
  }
  pauseTimer() {
    clearTimeout(this.playInterval);
    this.isPlaying = true;
  }
  formatNumber(t) {
    if (t.toString().length === 1) {
      return "0" + t;
    } else {
      return t;
    }
  }
}
customElements.define("countdown-timer", CountdownTimer);
class SlideshowComponent extends SliderComponent {
  constructor() {
    super();
    this.sliderControlWrapper = this.querySelector(".slider-buttons");
    this.enableSliderLooping = true;
    this.scrollMultiplier = isRtl ? -1 : 1;
    if (!this.sliderControlWrapper) {
      return;
    }
    this.sliderFirstItemNode = this.slider.querySelector(".slideshow__slide");
    if (this.sliderItemsToShow.length > 0) {
      this.currentPage = 1;
    }
    this.sliderControlLinksArray = Array.from(this.sliderControlWrapper.querySelectorAll(".slider-counter__link"));
    this.sliderControlLinksArray.forEach(t => t.addEventListener("click", this.linkToSlide.bind(this)));
    this.slider.addEventListener("scroll", this.setSlideVisibility.bind(this));
    this.setSlideVisibility();
    if (this.slider.getAttribute("data-autoplay") === "true") {
      this.setAutoPlay();
    }
  }
  setAutoPlay() {
    this.sliderAutoplayButton = this.querySelector(".slideshow__autoplay");
    this.autoplaySpeed = this.slider.dataset.speed * 1000;
    this.sliderAutoplayButton.addEventListener("click", this.autoPlayToggle.bind(this));
    this.addEventListener("mouseover", this.focusInHandling.bind(this));
    this.addEventListener("mouseleave", this.focusOutHandling.bind(this));
    this.addEventListener("focusin", this.focusInHandling.bind(this));
    this.addEventListener("focusout", this.focusOutHandling.bind(this));
    this.play();
    this.autoplayButtonIsSetToPlay = true;
  }
  onButtonClick(t) {
    super.onButtonClick(t);
    let e = this.currentPage === 1;
    let i = this.currentPage === this.sliderItemsToShow.length;
    if (e || i) {
      if (e && t.currentTarget.name === "previous") {
        this.slideScrollPosition = this.slider.scrollLeft * this.scrollMultiplier + this.sliderFirstItemNode.clientWidth * this.sliderItemsToShow.length;
      } else if (i && t.currentTarget.name === "next") {
        this.slideScrollPosition = 0;
      }
      this.slider.scrollTo({
        left: this.slideScrollPosition * this.scrollMultiplier
      });
    }
  }
  update() {
    super.update();
    this.sliderControlButtons = this.querySelectorAll(".slider-counter__link");
    this.prevButton.removeAttribute("disabled");
    if (this.sliderControlButtons.length) {
      this.sliderControlButtons.forEach(t => {
        t.classList.remove("slider-counter__link--active");
        t.removeAttribute("aria-current");
      });
      this.sliderControlButtons[this.currentPage - 1].classList.add("slider-counter__link--active");
      this.sliderControlButtons[this.currentPage - 1].setAttribute("aria-current", true);
    }
  }
  autoPlayToggle() {
    this.togglePlayButtonState(this.autoplayButtonIsSetToPlay);
    if (this.autoplayButtonIsSetToPlay) {
      this.pause();
    } else {
      this.play();
    }
    this.autoplayButtonIsSetToPlay = !this.autoplayButtonIsSetToPlay;
  }
  focusOutHandling(t) {
    let e = t.target === this.sliderAutoplayButton || this.sliderAutoplayButton.contains(t.target);
    if (this.autoplayButtonIsSetToPlay && !e) {
      this.play();
    }
  }
  focusInHandling(t) {
    let e = t.target === this.sliderAutoplayButton || this.sliderAutoplayButton.contains(t.target);
    if (e && this.autoplayButtonIsSetToPlay) {
      this.play();
    } else if (this.autoplayButtonIsSetToPlay) {
      this.pause();
    }
  }
  play() {
    this.slider.setAttribute("aria-live", "off");
    clearInterval(this.autoplay);
    this.autoplay = setInterval(this.autoRotateSlides.bind(this), this.autoplaySpeed);
  }
  pause() {
    this.slider.setAttribute("aria-live", "polite");
    clearInterval(this.autoplay);
  }
  togglePlayButtonState(t) {
    if (t) {
      this.sliderAutoplayButton.classList.add("slideshow__autoplay--paused");
      this.sliderAutoplayButton.setAttribute("aria-label", window.accessibilityStrings.playSlideshow);
    } else {
      this.sliderAutoplayButton.classList.remove("slideshow__autoplay--paused");
      this.sliderAutoplayButton.setAttribute("aria-label", window.accessibilityStrings.pauseSlideshow);
    }
  }
  autoRotateSlides() {
    let t = this.currentPage === this.sliderItems.length ? 0 : this.slider.scrollLeft * this.scrollMultiplier + this.slider.querySelector(".slideshow__slide").clientWidth;
    this.slider.scrollTo({
      left: t * this.scrollMultiplier
    });
  }
  setSlideVisibility() {
    this.sliderItemsToShow.forEach((t, e) => {
      let i = t.querySelectorAll("a");
      if (e === this.currentPage - 1) {
        if (i.length) {
          i.forEach(t => {
            t.removeAttribute("tabindex");
          });
        }
        t.setAttribute("aria-hidden", "false");
        t.removeAttribute("tabindex");
      } else {
        if (i.length) {
          i.forEach(t => {
            t.setAttribute("tabindex", "-1");
          });
        }
        t.setAttribute("aria-hidden", "true");
        t.setAttribute("tabindex", "-1");
      }
    });
  }
  linkToSlide(t) {
    t.preventDefault();
    let e = this.slider.scrollLeft * this.scrollMultiplier;
    let i = e + this.sliderFirstItemNode.clientWidth * (this.sliderControlLinksArray.indexOf(t.currentTarget) + 1 - this.currentPage);
    this.slider.scrollTo({
      left: i * this.scrollMultiplier
    });
  }
}
function _defineProperties(t, e) {
  for (var i = 0; i < e.length; i++) {
    var s = e[i];
    s.enumerable = s.enumerable || false;
    s.configurable = true;
    if ("value" in s) {
      s.writable = true;
    }
    Object.defineProperty(t, s.key, s);
  }
}
function _createClass(t, e, i) {
  if (e) {
    _defineProperties(t.prototype, e);
  }
  if (i) {
    _defineProperties(t, i);
  }
  Object.defineProperty(t, "prototype", {
    writable: false
  });
  return t;
}
customElements.define("slideshow-component", SlideshowComponent);
(function (t, e) {
  if (typeof exports == "object" && typeof module != "undefined") {
    module.exports = e();
  } else if (typeof define == "function" && define.amd) {
    define(e);
  } else {
    (t = typeof globalThis != "undefined" ? globalThis : t || self).Splide = e();
  }
})(this, function () {
  "use strict";

  var t = "(prefers-reduced-motion: reduce)";
  function e(t) {
    t.length = 0;
  }
  function i(t, e, i) {
    return Array.prototype.slice.call(t, e, i);
  }
  function s(t) {
    return t.bind.apply(t, [null].concat(i(arguments, 1)));
  }
  var n = setTimeout;
  var r = function t() { };
  function o(t) {
    return requestAnimationFrame(t);
  }
  function a(t, e) {
    return typeof e === t;
  }
  function l(t) {
    return !p(t) && a("object", t);
  }
  var d = Array.isArray;
  var c = s(a, "function");
  var h = s(a, "string");
  var u = s(a, "undefined");
  function p(t) {
    return t === null;
  }
  function m(t) {
    try {
      return t instanceof (t.ownerDocument.defaultView || window).HTMLElement;
    } catch (e) {
      return false;
    }
  }
  function f(t) {
    if (d(t)) {
      return t;
    } else {
      return [t];
    }
  }
  function v(t, e) {
    f(t).forEach(e);
  }
  function g(t, e) {
    return t.indexOf(e) > -1;
  }
  function y(t, e) {
    t.push.apply(t, f(e));
    return t;
  }
  function b(t, e, i) {
    if (t) {
      v(e, function (e) {
        if (e) {
          t.classList[i ? "add" : "remove"](e);
        }
      });
    }
  }
  function $(t, e) {
    b(t, h(e) ? e.split(" ") : e, true);
  }
  function S(t, e) {
    v(e, t.appendChild.bind(t));
  }
  function C(t, e) {
    v(t, function (t) {
      var i = (e || t).parentNode;
      if (i) {
        i.insertBefore(t, e);
      }
    });
  }
  function E(t, e) {
    return m(t) && (t.msMatchesSelector || t.matches).call(t, e);
  }
  function k(t, e) {
    var s = t ? i(t.children) : [];
    if (e) {
      return s.filter(function (t) {
        return E(t, e);
      });
    } else {
      return s;
    }
  }
  function x(t, e) {
    if (e) {
      return k(t, e)[0];
    } else {
      return t.firstElementChild;
    }
  }
  var _ = Object.keys;
  function L(t, e, i) {
    if (t) {
      (i ? _(t).reverse() : _(t)).forEach(function (i) {
        if (i !== "__proto__") {
          e(t[i], i);
        }
      });
    }
    return t;
  }
  function w(t) {
    i(arguments, 1).forEach(function (e) {
      L(e, function (i, s) {
        t[s] = e[s];
      });
    });
    return t;
  }
  function A(t) {
    i(arguments, 1).forEach(function (e) {
      L(e, function (e, i) {
        if (d(e)) {
          t[i] = e.slice();
        } else if (l(e)) {
          t[i] = A({}, l(t[i]) ? t[i] : {}, e);
        } else {
          t[i] = e;
        }
      });
    });
    return t;
  }
  function T(t, e) {
    v(e || _(t), function (e) {
      delete t[e];
    });
  }
  function M(t, e) {
    v(t, function (t) {
      v(e, function (e) {
        if (t) {
          t.removeAttribute(e);
        }
      });
    });
  }
  function B(t, e, i) {
    if (l(e)) {
      L(e, function (e, i) {
        B(t, i, e);
      });
    } else {
      v(t, function (t) {
        if (p(i) || i === "") {
          M(t, e);
        } else {
          t.setAttribute(e, String(i));
        }
      });
    }
  }
  function P(t, e, i) {
    var s = document.createElement(t);
    if (e) {
      if (h(e)) {
        $(s, e);
      } else {
        B(s, e);
      }
    }
    if (i) {
      S(i, s);
    }
    return s;
  }
  function I(t, e, i) {
    if (u(i)) {
      return getComputedStyle(t)[e];
    }
    if (!p(i)) {
      t.style[e] = "" + i;
    }
  }
  function q(t, e) {
    I(t, "display", e);
  }
  function D(t) {
    if (!t.setActive || !t.setActive()) {
      t.focus({
        preventScroll: true
      });
    }
  }
  function H(t, e) {
    return t.getAttribute(e);
  }
  function O(t, e) {
    return t && t.classList.contains(e);
  }
  function R(t) {
    return t.getBoundingClientRect();
  }
  function z(t) {
    v(t, function (t) {
      if (t && t.parentNode) {
        t.parentNode.removeChild(t);
      }
    });
  }
  function F(t) {
    return x(new DOMParser().parseFromString(t, "text/html").body);
  }
  function N(t, e) {
    t.preventDefault();
    if (e) {
      t.stopPropagation();
      t.stopImmediatePropagation();
    }
  }
  function V(t, e) {
    return t && t.querySelector(e);
  }
  function W(t, e) {
    if (e) {
      return i(t.querySelectorAll(e));
    } else {
      return [];
    }
  }
  function U(t, e) {
    b(t, e, false);
  }
  function X(t) {
    return t.timeStamp;
  }
  function j(t) {
    if (h(t)) {
      return t;
    } else if (t) {
      return t + "px";
    } else {
      return "";
    }
  }
  var G = "splide";
  var Y = "data-" + G;
  function K(t, e) {
    if (!t) {
      throw Error("[" + G + "] " + (e || ""));
    }
  }
  var J = Math.min;
  var Q = Math.max;
  var Z = Math.floor;
  var tt = Math.ceil;
  var te = Math.abs;
  function ti(t, e, i) {
    return te(t - e) < i;
  }
  function ts(t, e, i, s) {
    var n = J(e, i);
    var r = Q(e, i);
    if (s) {
      return n < t && t < r;
    } else {
      return n <= t && t <= r;
    }
  }
  function tn(t, e, i) {
    var s = J(e, i);
    var n = Q(e, i);
    return J(Q(s, t), n);
  }
  function tr(t) {
    return +(t > 0) - +(t < 0);
  }
  function to(t, e) {
    v(e, function (e) {
      t = t.replace("%s", "" + e);
    });
    return t;
  }
  function ta(t) {
    if (t < 10) {
      return "0" + t;
    } else {
      return "" + t;
    }
  }
  var tl = {};
  function td() {
    var t = [];
    function i(t, e, i) {
      v(t, function (t) {
        if (t) {
          v(e, function (e) {
            e.split(" ").forEach(function (e) {
              var s = e.split(".");
              i(t, s[0], s[1]);
            });
          });
        }
      });
    }
    return {
      bind: function e(s, n, r, o) {
        i(s, n, function (e, i, s) {
          var n = "addEventListener" in e;
          var a = n ? e.removeEventListener.bind(e, i, r, o) : e.removeListener.bind(e, r);
          if (n) {
            e.addEventListener(i, r, o);
          } else {
            e.addListener(r);
          }
          t.push([e, i, s, r, a]);
        });
      },
      unbind: function e(s, n, r) {
        i(s, n, function (e, i, s) {
          t = t.filter(function (t) {
            return t[0] !== e || t[1] !== i || t[2] !== s || !!r && t[3] !== r || (t[4](), false);
          });
        });
      },
      dispatch: function t(e, i, s) {
        var n;
        if (typeof CustomEvent == "function") {
          n = new CustomEvent(i, {
            bubbles: true,
            detail: s
          });
        } else {
          (n = document.createEvent("CustomEvent")).initCustomEvent(i, true, false, s);
        }
        e.dispatchEvent(n);
        return n;
      },
      destroy: function i() {
        t.forEach(function (t) {
          t[4]();
        });
        e(t);
      }
    };
  }
  var tc = "mounted";
  var th = "ready";
  var tu = "move";
  var tp = "moved";
  var tm = "click";
  var tf = "refresh";
  var tv = "updated";
  var tg = "resize";
  var ty = "resized";
  var tb = "scroll";
  var t$ = "scrolled";
  var tS = "destroy";
  var tC = "navigation:mounted";
  var tE = "autoplay:play";
  var tk = "autoplay:pause";
  var tx = "lazyload:loaded";
  function t_(t) {
    var e = t ? t.event.bus : document.createDocumentFragment();
    var n = td();
    if (t) {
      t.event.on(tS, n.destroy);
    }
    return w(n, {
      bus: e,
      on: function t(i, s) {
        n.bind(e, f(i).join(" "), function (t) {
          s.apply(s, d(t.detail) ? t.detail : []);
        });
      },
      off: s(n.unbind, e),
      emit: function t(s) {
        n.dispatch(e, s, i(arguments, 1));
      }
    });
  }
  function tL(t, e, i, s) {
    var n;
    var r;
    var a = Date.now;
    var l = 0;
    var d = true;
    var c = 0;
    function h() {
      if (!d) {
        l = t ? J((a() - n) / t, 1) : 1;
        if (i) {
          i(l);
        }
        if (l >= 1 && (e(), n = a(), s && ++c >= s)) {
          return u();
        }
        r = o(h);
      }
    }
    function u() {
      d = true;
    }
    function p() {
      if (r) {
        cancelAnimationFrame(r);
      }
      l = 0;
      r = 0;
      d = true;
    }
    function m(e) {
      t = e;
    }
    function f() {
      return d;
    }
    return {
      start: function e(i) {
        if (!i) {
          p();
        }
        n = a() - (i ? l * t : 0);
        d = false;
        r = o(h);
      },
      rewind: function t() {
        n = a();
        l = 0;
        if (i) {
          i(l);
        }
      },
      pause: u,
      cancel: p,
      set: m,
      isPaused: f
    };
  }
  var tw = "Arrow";
  var t8 = tw + "Left";
  var tA = tw + "Right";
  var tT = tw + "Up";
  var tM = tw + "Down";
  var tB = {
    width: ["height"],
    left: ["top", "right"],
    right: ["bottom", "left"],
    x: ["y"],
    X: ["Y"],
    Y: ["X"],
    ArrowLeft: [tT, tA],
    ArrowRight: [tM, t8]
  };
  var tP = "role";
  var tI = "tabindex";
  var tq = "aria-";
  var tD = tq + "controls";
  var tH = tq + "current";
  var tO = tq + "selected";
  var tR = tq + "label";
  var tz = tq + "labelledby";
  var tF = tq + "hidden";
  var tN = tq + "orientation";
  var tV = tq + "roledescription";
  var tW = tq + "live";
  var t0 = tq + "busy";
  var t2 = tq + "atomic";
  var t9 = [tP, tI, "disabled", tD, tH, tR, tz, tF, tN, tV];
  var tU = G + "__";
  var t3 = G;
  var t1 = tU + "track";
  var t4 = tU + "list";
  var tX = tU + "slide";
  var tj = tX + "--clone";
  var tG = tX + "__container";
  var tY = tU + "arrows";
  var t6 = tU + "arrow";
  var tK = t6 + "--prev";
  var t5 = t6 + "--next";
  var t7 = tU + "pagination";
  var tJ = t7 + "__page";
  var tQ = tU + "progress__bar";
  var tZ = tU + "toggle";
  var et = tU + "sr";
  var ee = "is-active";
  var ei = "is-prev";
  var es = "is-next";
  var en = "is-visible";
  var er = "is-loading";
  var eo = "is-focus-in";
  var ea = "is-overflow";
  var el = [ee, en, ei, es, er, eo, ea];
  var ed = "touchstart mousedown";
  var ec = "touchmove mousemove";
  var eh = "touchend touchcancel mouseup click";
  var eu = "slide";
  var ep = "loop";
  var em = "fade";
  var ef = Y + "-interval";
  var ev = {
    passive: false,
    capture: true
  };
  var eg = {
    Spacebar: " ",
    Right: tA,
    Left: t8,
    Up: tT,
    Down: tM
  };
  function ey(t) {
    return eg[t = h(t) ? t : t.key] || t;
  }
  var eb = "keydown";
  var e$ = Y + "-lazy";
  var eS = e$ + "-srcset";
  var eC = "[" + e$ + "], [" + eS + "]";
  var eE = [" ", "Enter"];
  var ek = Object.freeze({
    __proto__: null,
    Media: function e(i, s, n) {
      var r = i.state;
      var o = n.breakpoints || {};
      var a = n.reducedMotion || {};
      var l = td();
      var d = [];
      function c(t) {
        if (t) {
          l.destroy();
        }
      }
      function h(t, e) {
        var i = matchMedia(e);
        l.bind(i, "change", u);
        d.push([t, i]);
      }
      function u() {
        var t = r.is(7);
        var e = n.direction;
        var s = d.reduce(function (t, e) {
          return A(t, e[1].matches ? e[0] : {});
        }, {});
        T(n);
        p(s);
        if (n.destroy) {
          i.destroy(n.destroy === "completely");
        } else if (t) {
          c(true);
          i.mount();
        } else if (e !== n.direction) {
          i.refresh();
        }
      }
      function p(t, e, s) {
        A(n, t);
        if (e) {
          A(Object.getPrototypeOf(n), t);
        }
        if (s || !r.is(1)) {
          i.emit(tv, n);
        }
      }
      return {
        setup: function e() {
          var i = n.mediaQuery === "min";
          _(o).sort(function (t, e) {
            if (i) {
              return +t - +e;
            } else {
              return +e - +t;
            }
          }).forEach(function (t) {
            h(o[t], "(" + (i ? "min" : "max") + "-width:" + t + "px)");
          });
          h(a, t);
          u();
        },
        destroy: c,
        reduce: function e(i) {
          if (matchMedia(t).matches) {
            if (i) {
              A(n, a);
            } else {
              T(n, _(a));
            }
          }
        },
        set: p
      };
    },
    Direction: function t(e, i, s) {
      return {
        resolve: function t(e, i, n) {
          var r = (n = n || s.direction) !== "rtl" || i ? n === "ttb" ? 0 : -1 : 1;
          return tB[e] && tB[e][r] || e.replace(/width|left|right/i, function (t, e) {
            var i = tB[t.toLowerCase()][r] || t;
            if (e > 0) {
              return i.charAt(0).toUpperCase() + i.slice(1);
            } else {
              return i;
            }
          });
        },
        orient: function t(e) {
          return e * (s.direction === "rtl" ? 1 : -1);
        }
      };
    },
    Elements: function t(i, s, n) {
      var r;
      var o;
      var a;
      var l = t_(i);
      var d = l.on;
      var h = l.bind;
      var u = i.root;
      var p = n.i18n;
      var m = {};
      var f = [];
      var v = [];
      var g = [];
      function S() {
        var t;
        var e;
        var i;
        r = A("." + t1);
        o = x(r, "." + t4);
        K(r && o, "A track/list element is missing.");
        y(f, k(o, "." + tX + ":not(." + tj + ")"));
        L({
          arrows: tY,
          pagination: t7,
          prev: tK,
          next: t5,
          bar: tQ,
          toggle: tZ
        }, function (t, e) {
          m[e] = A("." + t);
        });
        w(m, {
          root: u,
          track: r,
          list: o,
          slides: f
        });
        e = u.id || "" + (t = G) + ta(tl[t] = (tl[t] || 0) + 1);
        i = n.role;
        u.id = e;
        r.id = r.id || e + "-track";
        o.id = o.id || e + "-list";
        if (!H(u, tP) && u.tagName !== "SECTION" && i) {
          B(u, tP, i);
        }
        B(u, tV, p.carousel);
        B(o, tP, "presentation");
        _();
      }
      function C(t) {
        var i = t9.concat("style");
        e(f);
        U(u, v);
        U(r, g);
        M([r, o], i);
        M(u, t ? i : ["style", tV]);
      }
      function _() {
        U(u, v);
        U(r, g);
        v = T(t3);
        g = T(t1);
        $(u, v);
        $(r, g);
        B(u, tR, n.label);
        B(u, tz, n.labelledby);
      }
      function A(t) {
        var e = V(u, t);
        if (e && function t(e, i) {
          if (c(e.closest)) {
            return e.closest(i);
          }
          for (var s = e; s && s.nodeType === 1 && !E(s, i);) {
            s = s.parentElement;
          }
          return s;
        }(e, "." + t3) === u) {
          return e;
        } else {
          return undefined;
        }
      }
      function T(t) {
        return [t + "--" + n.type, t + "--" + n.direction, n.drag && t + "--draggable", n.isNavigation && t + "--nav", t === t3 && ee];
      }
      return w(m, {
        setup: S,
        mount: function t() {
          d(tf, C);
          d(tf, S);
          d(tv, _);
          h(document, ed + " keydown", function (t) {
            a = t.type === "keydown";
          }, {
            capture: true
          });
          h(u, "focusin", function () {
            b(u, eo, !!a);
          });
        },
        destroy: C
      });
    },
    Slides: function t(i, n, r) {
      var o = t_(i);
      var a = o.on;
      var l = o.emit;
      var d = o.bind;
      var u = n.Elements;
      var p = u.slides;
      var y = u.list;
      var k = [];
      function _() {
        p.forEach(function (t, e) {
          w(t, e, -1);
        });
      }
      function L() {
        T(function (t) {
          t.destroy();
        });
        e(k);
      }
      function w(t, e, n) {
        var r = function t(e, i, n, r) {
          var o;
          var a = t_(e);
          var l = a.on;
          var d = a.emit;
          var c = a.bind;
          var h = e.Components;
          var u = e.root;
          var p = e.options;
          var m = p.isNavigation;
          var f = p.updateOnMove;
          var v = p.i18n;
          var g = p.pagination;
          var y = p.slideFocus;
          var $ = h.Direction.resolve;
          var S = H(r, "style");
          var C = H(r, tR);
          var E = n > -1;
          var k = x(r, "." + tG);
          function _() {
            var t = e.splides.map(function (t) {
              var e = t.splide.Components.Slides.getAt(i);
              if (e) {
                return e.slide.id;
              } else {
                return "";
              }
            }).join(" ");
            B(r, tR, to(v.slideX, (E ? n : i) + 1));
            B(r, tD, t);
            B(r, tP, y ? "button" : "");
            if (y) {
              M(r, tV);
            }
          }
          function L() {
            if (!o) {
              w();
            }
          }
          function w() {
            if (!o) {
              var t;
              var s = e.index;
              if ((t = A()) !== O(r, ee)) {
                b(r, ee, t);
                B(r, tH, m && t || "");
                d(t ? "active" : "inactive", T);
              }
              (function t() {
                var i = function t() {
                  if (e.is(em)) {
                    return A();
                  }
                  var i = R(h.Elements.track);
                  var s = R(r);
                  var n = $("left", true);
                  var o = $("right", true);
                  return Z(i[n]) <= tt(s[n]) && Z(s[o]) <= tt(i[o]);
                }();
                var s = !i && (!A() || E);
                if (!e.state.is([4, 5])) {
                  B(r, tF, s || "");
                }
                B(W(r, p.focusableNodes || ""), tI, s ? -1 : "");
                if (y) {
                  B(r, tI, s ? -1 : 0);
                }
                if (i !== O(r, en)) {
                  b(r, en, i);
                  d(i ? "visible" : "hidden", T);
                }
                if (!i && document.activeElement === r) {
                  var n = h.Slides.getAt(e.index);
                  if (n) {
                    D(n.slide);
                  }
                }
              })();
              b(r, ei, i === s - 1);
              b(r, es, i === s + 1);
            }
          }
          function A() {
            var t = e.index;
            return t === i || p.cloneStatus && t === n;
          }
          var T = {
            index: i,
            slideIndex: n,
            slide: r,
            container: k,
            isClone: E,
            mount: function t() {
              if (!E) {
                r.id = u.id + "-slide" + ta(i + 1);
                B(r, tP, g ? "tabpanel" : "group");
                B(r, tV, v.slide);
                B(r, tR, C || to(v.slideLabel, [i + 1, e.length]));
              }
              c(r, "click", s(d, tm, T));
              c(r, "keydown", s(d, "sk", T));
              l([tp, "sh", t$], w);
              l(tC, _);
              if (f) {
                l(tu, L);
              }
            },
            destroy: function t() {
              o = true;
              a.destroy();
              U(r, el);
              M(r, t9);
              B(r, "style", S);
              B(r, tR, C || "");
            },
            update: w,
            style: function t(e, i, s) {
              I(s && k || r, e, i);
            },
            isWithin: function t(s, n) {
              var r = te(s - i);
              if (!E && (p.rewind || e.is(ep))) {
                r = J(r, e.length - r);
              }
              return r <= n;
            }
          };
          return T;
        }(i, e, n, t);
        r.mount();
        k.push(r);
        k.sort(function (t, e) {
          return t.index - e.index;
        });
      }
      function A(t) {
        if (t) {
          return P(function (t) {
            return !t.isClone;
          });
        } else {
          return k;
        }
      }
      function T(t, e) {
        A(e).forEach(t);
      }
      function P(t) {
        return k.filter(c(t) ? t : function (e) {
          if (h(t)) {
            return E(e.slide, t);
          } else {
            return g(f(t), e.index);
          }
        });
      }
      return {
        mount: function t() {
          _();
          a(tf, L);
          a(tf, _);
        },
        destroy: L,
        update: function t() {
          T(function (t) {
            t.update();
          });
        },
        register: w,
        get: A,
        getIn: function t(e) {
          var i = n.Controller;
          var s = i.toIndex(e);
          var o = i.hasFocus() ? 1 : r.perPage;
          return P(function (t) {
            return ts(t.index, s, s + o - 1);
          });
        },
        getAt: function t(e) {
          return P(e)[0];
        },
        add: function t(e, i) {
          v(e, function (t) {
            if (h(t)) {
              t = F(t);
            }
            if (m(t)) {
              var e;
              var n;
              var o;
              var a;
              var c = p[i];
              if (c) {
                C(t, c);
              } else {
                S(y, t);
              }
              $(t, r.classes.slide);
              e = t;
              n = s(l, tg);
              if (a = (o = W(e, "img")).length) {
                o.forEach(function (t) {
                  d(t, "load error", function () {
                    if (! --a) {
                      n();
                    }
                  });
                });
              } else {
                n();
              }
            }
          });
          l(tf);
        },
        remove: function t(e) {
          z(P(e).map(function (t) {
            return t.slide;
          }));
          l(tf);
        },
        forEach: T,
        filter: P,
        style: function t(e, i, s) {
          T(function (t) {
            t.style(e, i, s);
          });
        },
        getLength: function t(e) {
          if (e) {
            return p.length;
          } else {
            return k.length;
          }
        },
        isEnough: function t() {
          return k.length > r.perPage;
        }
      };
    },
    Layout: function t(e, i, n) {
      var r;
      var o;
      var a;
      var d = t_(e);
      var c = d.on;
      var h = d.bind;
      var u = d.emit;
      var p = i.Slides;
      var m = i.Direction.resolve;
      var f = i.Elements;
      var v = f.root;
      var g = f.track;
      var y = f.list;
      var $ = p.getAt;
      var S = p.style;
      function C() {
        r = n.direction === "ttb";
        I(v, "maxWidth", j(n.width));
        I(g, m("paddingLeft"), k(false));
        I(g, m("paddingRight"), k(true));
        E(true);
      }
      function E(t) {
        var e;
        var i = R(v);
        if (t || o.width !== i.width || o.height !== i.height) {
          I(g, "height", (e = "", r && (e = x(), K(e, "height or heightRatio is missing."), e = "calc(" + e + " - " + k(false) + " - " + k(true) + ")"), e));
          S(m("marginRight"), j(n.gap));
          S("width", n.autoWidth ? null : j(n.fixedWidth) || (r ? "" : _()));
          S("height", j(n.fixedHeight) || (r ? n.autoHeight ? null : _() : x()), true);
          o = i;
          u(ty);
          if (a !== (a = B())) {
            b(v, ea, a);
            u("overflow", a);
          }
        }
      }
      function k(t) {
        var e = n.padding;
        var i = m(t ? "right" : "left");
        return e && j(e[i] || (l(e) ? 0 : e)) || "0px";
      }
      function x() {
        return j(n.height || R(y).width * n.heightRatio);
      }
      function _() {
        var t = j(n.gap);
        return "calc((100%" + (t && " + " + t) + ")/" + (n.perPage || 1) + (t && " - " + t) + ")";
      }
      function L() {
        return R(y)[m("width")];
      }
      function w(t, e) {
        var i = $(t || 0);
        if (i) {
          return R(i.slide)[m("width")] + (e ? 0 : M());
        } else {
          return 0;
        }
      }
      function A(t, e) {
        var i = $(t);
        if (i) {
          var s = R(i.slide)[m("right")];
          var n = R(y)[m("left")];
          return te(s - n) + (e ? 0 : M());
        }
        return 0;
      }
      function T(t) {
        return A(e.length - 1) - A(0) + w(0, t);
      }
      function M() {
        var t = $(0);
        return t && parseFloat(I(t.slide, m("marginRight"))) || 0;
      }
      function B() {
        return e.is(em) || T(true) > L();
      }
      return {
        mount: function t() {
          var e;
          var i;
          C();
          h(window, "resize load", (e = s(u, tg), i = tL(0, e, null, 1), function () {
            if (i.isPaused()) {
              i.start();
            }
          }));
          c([tv, tf], C);
          c(tg, E);
        },
        resize: E,
        listSize: L,
        slideSize: w,
        sliderSize: T,
        totalSize: A,
        getPadding: function t(e) {
          return parseFloat(I(g, m("padding" + (e ? "Right" : "Left")))) || 0;
        },
        isOverflow: B
      };
    },
    Clones: function t(i, s, n) {
      var r;
      var o = t_(i);
      var a = o.on;
      var l = s.Elements;
      var d = s.Slides;
      var c = s.Direction.resolve;
      var h = [];
      function p() {
        a(tf, m);
        a([tv, tg], v);
        if (r = g()) {
          (function t(e) {
            var s = d.get().slice();
            var r = s.length;
            if (r) {
              while (s.length < e) {
                y(s, s);
              }
              y(s.slice(-e), s.slice(0, e)).forEach(function (t, o) {
                var a;
                var c;
                var u;
                var p = o < e;
                a = t.slide;
                c = o;
                u = a.cloneNode(true);
                $(u, n.classes.clone);
                u.id = i.root.id + "-clone" + ta(c + 1);
                var m = u;
                if (p) {
                  C(m, s[0].slide);
                } else {
                  S(l.list, m);
                }
                y(h, m);
                d.register(m, o - e + (p ? 0 : r), t.index);
              });
            }
          })(r);
          s.Layout.resize(true);
        }
      }
      function m() {
        f();
        p();
      }
      function f() {
        z(h);
        e(h);
        o.destroy();
      }
      function v() {
        var t = g();
        if (r !== t && (r < t || !t)) {
          o.emit(tf);
        }
      }
      function g() {
        var t = n.clones;
        if (i.is(ep)) {
          if (u(t)) {
            var e = n[c("fixedWidth")] && s.Layout.slideSize(0);
            t = e && tt(R(l.track)[c("width")] / e) || n[c("autoWidth")] && i.length || n.perPage * 2;
          }
        } else {
          t = 0;
        }
        return t;
      }
      return {
        mount: p,
        destroy: f
      };
    },
    Move: function t(e, i, s) {
      var n;
      var r = t_(e);
      var o = r.on;
      var a = r.emit;
      var l = e.state.set;
      var d = e.state;
      var c = i.Layout;
      var h = c.slideSize;
      var p = c.getPadding;
      var m = c.totalSize;
      var f = c.listSize;
      var v = c.sliderSize;
      var g = i.Direction;
      var y = g.resolve;
      var b = g.orient;
      var $ = i.Elements;
      var S = $.list;
      var C = $.track;
      var E = 0;
      function k() {
        return E;
      }
      function x() {
        if (!i.Controller.isBusy()) {
          i.Scroll.cancel();
          _(e.index);
          i.Slides.update();
        }
      }
      function _(t) {
        L(M(t, true));
      }
      function L(t, n) {
        if (!e.is(em)) {
          if (s.paddingCalc && s.type === "slide" && !d.is(6)) {
            E = t >= s.padding.right * -1 ? 0 : v() + t - s.padding.right <= h() ? s.padding.right : s.padding.right / 2;
          }
          var r = n ? t : function t(s) {
            if (e.is(ep)) {
              var n = T(s);
              var r = n > i.Controller.getEnd();
              if (n < 0 || r) {
                s = w(s, r);
              }
            }
            return s;
          }(t);
          I(S, "transform", `translate${y("X")}(${r + E}px)`);
          if (t !== r) {
            a("sh");
          }
        }
      }
      function w(t, e) {
        var i = t - P(e);
        var s = v();
        return t - b(s * (tt(te(i) / s) || 1)) * (e ? 1 : -1);
      }
      function A() {
        L(B(), true);
        n.cancel();
      }
      function T(t) {
        for (var e = i.Slides.get(), s = 0, n = Infinity, r = 0; r < e.length; r++) {
          var o = e[r].index;
          var a = te(M(o, true) - t);
          if (a <= n) {
            n = a;
            s = o;
          } else {
            break;
          }
        }
        return s;
      }
      function M(t, i) {
        var n;
        var r;
        var o;
        var a = b(m(t - 1) - (n = t, r = s.focus, r === "center" ? (f() - h(n, true)) / 2 : +r * h(n) || 0));
        if (i) {
          o = a;
          if (s.trimSpace && e.is(eu)) {
            o = tn(o, 0, b(v(true) - f()));
          }
          return o;
        } else {
          return a;
        }
      }
      function B() {
        var t = y("left");
        return R(S)[t] - R(C)[t] + b(p(false)) - E;
      }
      function P(t) {
        return M(t ? i.Controller.getEnd() : 0, !!s.trimSpace);
      }
      return {
        mount: function t() {
          n = i.Transition;
          o([tc, ty, tv, tf], x);
        },
        move: function t(e, i, s, r) {
          var o;
          var d;
          if (e !== i && (o = e > s, d = b(w(B(), o)), o ? d >= 0 : d <= S[y("scrollWidth")] - R(C)[y("width")])) {
            A();
            L(w(B(), e > s), true);
          }
          l(4);
          a(tu, i, s, e);
          n.start(i, function () {
            l(3);
            a(tp, i, s, e);
            if (r) {
              r();
            }
          });
        },
        jump: _,
        translate: L,
        shift: w,
        cancel: A,
        toIndex: T,
        toPosition: M,
        getPosition: B,
        getLimit: P,
        exceededLimit: function t(e, i) {
          i = u(i) ? B() : i;
          var s = e !== true && b(i) < b(P(false));
          var n = e !== false && b(i) > b(P(true));
          return s || n;
        },
        reposition: x
      };
    },
    Controller: function t(e, i, n) {
      var r;
      var o;
      var a;
      var l;
      var d = t_(e);
      var c = d.on;
      var p = d.emit;
      var m = i.Move;
      var f = m.getPosition;
      var v = m.getLimit;
      var g = m.toPosition;
      var y = i.Slides;
      var b = y.isEnough;
      var $ = y.getLength;
      var S = n.omitEnd;
      var C = e.is(ep);
      var E = e.is(eu);
      var k = s(T, false);
      var x = s(T, true);
      var _ = n.start || 0;
      var L = _;
      function w() {
        o = $(true);
        a = n.perMove;
        l = n.perPage;
        r = P();
        var t = tn(_, 0, S ? r : o - 1);
        if (t !== _) {
          _ = t;
          m.reposition();
        }
      }
      function A() {
        if (r !== P()) {
          p("ei");
        }
      }
      function T(t, e) {
        var i;
        var s;
        var n = a || (H() ? 1 : l);
        var o = M(_ + n * (t ? -1 : 1), _, !a && !H());
        if (o === -1 && E) {
          i = f();
          if (!(te(i - (s = v(!t))) < 1)) {
            if (t) {
              return 0;
            } else {
              return r;
            }
          }
        }
        if (e) {
          return o;
        } else {
          return B(o);
        }
      }
      function M(t, i, s) {
        if (b() || H()) {
          var d = function t(i) {
            if (E && n.trimSpace === "move" && i !== _) {
              for (var s = f(); s === g(i, true) && ts(i, 0, e.length - 1, !n.rewind);) {
                if (i < _) {
                  --i;
                } else {
                  ++i;
                }
              }
            }
            return i;
          }(t);
          if (d !== t) {
            i = t;
            t = d;
            s = false;
          }
          if (t < 0 || t > r) {
            t = !a && (ts(0, t, i, true) || ts(r, i, t, true)) ? I(q(t)) : C ? s ? t < 0 ? -(o % l || l) : o : t : n.rewind ? t < 0 ? r : 0 : -1;
          } else if (s && t !== i) {
            t = I(q(i) + (t < i ? -1 : 1));
          }
        } else {
          t = -1;
        }
        return t;
      }
      function B(t) {
        if (C) {
          return (t + o) % o || 0;
        } else {
          return t;
        }
      }
      function P() {
        for (var t = o - (H() || C && a ? 1 : l); S && t-- > 0;) {
          if (g(o - 1, true) !== g(t, true)) {
            t++;
            break;
          }
        }
        return tn(t, 0, o - 1);
      }
      function I(t) {
        return tn(H() ? t : l * t, 0, r);
      }
      function q(t) {
        if (H()) {
          return J(t, r);
        } else {
          return Z((t >= r ? o - 1 : t) / l);
        }
      }
      function D(t) {
        if (t !== _) {
          L = _;
          _ = t;
        }
      }
      function H() {
        return !u(n.focus) || n.isNavigation;
      }
      function O() {
        return e.state.is([4, 5]) && !!n.waitForTransition;
      }
      return {
        mount: function t() {
          w();
          c([tv, tf, "ei"], w);
          c(ty, A);
        },
        go: function t(e, i, s) {
          if (!O()) {
            var n = function t(e) {
              var i = _;
              if (h(e)) {
                var s = e.match(/([+\-<>])(\d+)?/) || [];
                var n = s[1];
                var o = s[2];
                if (n === "+" || n === "-") {
                  i = M(_ + +("" + n + (+o || 1)), _);
                } else if (n === ">") {
                  i = o ? I(+o) : k(true);
                } else if (n === "<") {
                  i = x(true);
                }
              } else {
                i = C ? e : tn(e, 0, r);
              }
              return i;
            }(e);
            var o = B(n);
            if (o > -1 && (i || o !== _)) {
              D(o);
              m.move(n, o, L, s);
            }
          }
        },
        scroll: function t(e, s, n, o) {
          i.Scroll.scroll(e, s, n, function () {
            var t = B(m.toIndex(f()));
            D(S ? J(t, r) : t);
            if (o) {
              o();
            }
          });
        },
        getNext: k,
        getPrev: x,
        getAdjacent: T,
        getEnd: P,
        setIndex: D,
        getIndex: function t(e) {
          if (e) {
            return L;
          } else {
            return _;
          }
        },
        toIndex: I,
        toPage: q,
        toDest: function t(e) {
          var i = m.toIndex(e);
          if (E) {
            return tn(i, 0, r);
          } else {
            return i;
          }
        },
        hasFocus: H,
        isBusy: O
      };
    },
    Arrows: function t(e, i, n) {
      var r;
      var o;
      var a = t_(e);
      var l = a.on;
      var d = a.bind;
      var c = a.emit;
      var h = n.classes;
      var u = n.i18n;
      var p = i.Elements;
      var m = i.Controller;
      var f = p.arrows;
      var v = p.track;
      var g = f;
      var y = p.prev;
      var b = p.next;
      var E = {};
      function k() {
        var t;
        if ((t = n.arrows) && (!y || !b)) {
          g = f || P("div", h.arrows);
          y = A(true);
          b = A(false);
          r = true;
          S(g, [y, b]);
          if (!f) {
            C(g, v);
          }
        }
        if (y && b) {
          w(E, {
            prev: y,
            next: b
          });
          q(g, t ? "" : "none");
          $(g, o = tY + "--" + n.direction);
          if (t) {
            l([tc, tp, tf, t$, "ei"], T);
            d(b, "click", s(L, ">"));
            d(y, "click", s(L, "<"));
            T();
            B([y, b], tD, v.id);
            c("arrows:mounted", y, b);
          }
        }
        l(tv, x);
      }
      function x() {
        _();
        k();
      }
      function _() {
        a.destroy();
        U(g, o);
        if (r) {
          z(f ? [y, b] : g);
          y = b = null;
        } else {
          M([y, b], t9);
        }
      }
      function L(t) {
        m.go(t, true);
      }
      function A(t) {
        return F("<button class=\"" + h.arrow + " " + (t ? h.prev : h.next) + "\" type=\"button\"><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\" width=\"40\" height=\"40\" focusable=\"false\"><path d=\"" + (n.arrowPath || "m15.5 0.932-4.3 4.38 14.5 14.6-14.5 14.5 4.3 4.4 14.6-14.6 4.4-4.3-4.4-4.4-14.6-14.6z") + "\" />");
      }
      function T() {
        if (y && b) {
          var t = e.index;
          var i = m.getPrev();
          var s = m.getNext();
          var n = i > -1 && t < i ? u.last : u.prev;
          var r = s > -1 && t > s ? u.first : u.next;
          y.disabled = i < 0;
          b.disabled = s < 0;
          B(y, tR, n);
          B(b, tR, r);
          c("arrows:updated", y, b, i, s);
        }
      }
      return {
        arrows: E,
        mount: k,
        destroy: _,
        update: T
      };
    },
    Autoplay: function t(e, i, s) {
      var n;
      var r;
      var o = t_(e);
      var a = o.on;
      var l = o.bind;
      var d = o.emit;
      var c = tL(s.interval, e.go.bind(e, ">"), function t(e) {
        var i = u.bar;
        if (i) {
          I(i, "width", e * 100 + "%");
        }
        d("autoplay:playing", e);
      });
      var h = c.isPaused;
      var u = i.Elements;
      var p = i.Elements;
      var m = p.root;
      var f = p.toggle;
      var v = s.autoplay;
      var g = v === "pause";
      function y() {
        if (h() && i.Slides.isEnough()) {
          c.start(!s.resetProgress);
          r = n = g = false;
          C();
          d(tE);
        }
      }
      function $(t = true) {
        g = !!t;
        C();
        if (!h()) {
          c.pause();
          d(tk);
        }
      }
      function S() {
        if (!g) {
          if (n || r) {
            $(false);
          } else {
            y();
          }
        }
      }
      function C() {
        if (f) {
          b(f, ee, !g);
          B(f, tR, s.i18n[g ? "play" : "pause"]);
        }
      }
      function E(t) {
        var e = i.Slides.getAt(t);
        c.set(e && +H(e.slide, ef) || s.interval);
      }
      return {
        mount: function t() {
          if (v) {
            if (s.pauseOnHover) {
              l(m, "mouseenter mouseleave", function (t) {
                n = t.type === "mouseenter";
                S();
              });
            }
            if (s.pauseOnFocus) {
              l(m, "focusin focusout", function (t) {
                r = t.type === "focusin";
                S();
              });
            }
            if (f) {
              l(f, "click", function () {
                if (g) {
                  y();
                } else {
                  $(true);
                }
              });
            }
            a([tu, tb, tf], c.rewind);
            a(tu, E);
            if (f) {
              B(f, tD, u.track.id);
            }
            if (!g) {
              y();
            }
            C();
          }
        },
        destroy: c.cancel,
        play: y,
        pause: $,
        isPaused: h
      };
    },
    Cover: function t(e, i, n) {
      var r = t_(e).on;
      function o(t) {
        i.Slides.forEach(function (e) {
          var i = x(e.container || e.slide, "img");
          if (i && i.src) {
            a(t, i, e);
          }
        });
      }
      function a(t, e, i) {
        i.style("background", t ? "center/cover no-repeat url(\"" + e.src + "\")" : "", true);
        q(e, t ? "none" : "");
      }
      return {
        mount: function t() {
          if (n.cover) {
            r(tx, s(a, true));
            r([tc, tv, tf], s(o, true));
          }
        },
        destroy: s(o, false)
      };
    },
    Scroll: function t(e, i, n) {
      var r;
      var o;
      var a = t_(e);
      var l = a.on;
      var d = a.emit;
      var c = e.state.set;
      var h = i.Move;
      var u = h.getPosition;
      var p = h.getLimit;
      var m = h.exceededLimit;
      var f = h.translate;
      var v = e.is(eu);
      var g = 1;
      function y(t, e, n, a, l) {
        var p = u();
        S();
        if (n && (!v || !m())) {
          var f = i.Layout.sliderSize();
          var y = tr(t) * f * Z(te(t) / f) || 0;
          t = h.toPosition(i.Controller.toDest(t % f)) + y;
        }
        var C;
        var E;
        C = p;
        E = t;
        var k = te(C - E) < 1;
        g = 1;
        e = k ? 0 : e || Q(te(t - p) / 1.5, 800);
        o = a;
        r = tL(e, b, s($, p, t, l), 1);
        c(5);
        d(tb);
        r.start();
      }
      function b() {
        c(3);
        if (o) {
          o();
        }
        d(t$);
      }
      function $(t, e, i, s) {
        var r;
        var a;
        var l = u();
        var d = (t + (e - t) * (r = s, a = n.easingFunc, a ? a(r) : 1 - Math.pow(1 - r, 4)) - l) * g;
        f(l + d);
        if (v && !i && m()) {
          g *= 0.6;
          if (te(d) < 10) {
            y(p(m(true)), 600, false, o, true);
          }
        }
      }
      function S() {
        if (r) {
          r.cancel();
        }
      }
      function C() {
        if (r && !r.isPaused()) {
          S();
          b();
        }
      }
      return {
        mount: function t() {
          l(tu, S);
          l([tv, tf], C);
        },
        destroy: S,
        scroll: y,
        cancel: C
      };
    },
    Drag: function t(e, i, s) {
      var n;
      var o;
      var a;
      var d;
      var c;
      var h;
      var u;
      var p;
      var m = t_(e);
      var f = m.on;
      var v = m.emit;
      var g = m.bind;
      var y = m.unbind;
      var b = e.state;
      var $ = i.Move;
      var S = i.Scroll;
      var C = i.Controller;
      var k = i.Elements.track;
      var x = i.Media.reduce;
      var _ = i.Direction;
      var L = _.resolve;
      var w = _.orient;
      var A = $.getPosition;
      var T = $.exceededLimit;
      var M = false;
      function B() {
        var t;
        var e = s.drag;
        u = t = !e;
        d = e === "free";
      }
      function P(t) {
        h = false;
        if (!u) {
          var e;
          var i;
          var n = V(t);
          e = t.target;
          i = s.noDrag;
          if (!E(e, "." + tJ + ", ." + t6) && (!i || !E(e, i)) && (!!n || !t.button)) {
            if (C.isBusy()) {
              N(t, true);
            } else {
              p = n ? k : window;
              c = b.is([4, 5]);
              a = null;
              g(p, ec, I, ev);
              g(p, eh, q, ev);
              $.cancel();
              S.cancel();
              H(t);
            }
          }
        }
      }
      function I(t) {
        if (!b.is(6)) {
          b.set(6);
          v("drag");
        }
        if (t.cancelable) {
          if (c) {
            $.translate(n + (p = O(t), p / (M && e.is(eu) ? 5 : 1)));
            var i;
            var r;
            var o;
            var a;
            var d;
            var u;
            var p;
            var m = R(t) > 200;
            var f = M !== (M = T());
            if (m || f) {
              H(t);
            }
            h = true;
            v("dragging");
            N(t);
          } else {
            i = t;
            if (te(O(i)) > te(O(i, true))) {
              r = t;
              o = s.dragMinThreshold;
              a = l(o);
              d = a && o.mouse || 0;
              u = (a ? o.touch : +o) || 10;
              c = te(O(r)) > (V(r) ? u : d);
              N(t);
            }
          }
        }
      }
      function q(t) {
        var n;
        var r;
        var o;
        var a;
        var l;
        if (b.is(6)) {
          b.set(3);
          v("dragged");
        }
        if (c) {
          r = o = function t(i) {
            if (e.is(ep) || !M) {
              var s = R(i);
              if (s && s < 200) {
                return O(i) / s;
              }
            }
            return 0;
          }(n = t);
          a = A() + tr(r) * J(te(r) * (s.flickPower || 600), d ? Infinity : i.Layout.listSize() * (s.flickMaxPages || 1));
          l = s.rewind && s.rewindByDrag;
          x(false);
          if (d) {
            C.scroll(a, 0, s.snap);
          } else if (e.is(em)) {
            C.go(w(tr(o)) < 0 ? l ? "<" : "-" : l ? ">" : "+");
          } else if (e.is(eu) && M && l) {
            C.go(T(true) ? ">" : "<");
          } else {
            C.go(C.toDest(a), true);
          }
          x(true);
          N(t);
        }
        y(p, ec, I);
        y(p, eh, q);
        c = false;
      }
      function D(t) {
        if (!u && h) {
          N(t, true);
        }
      }
      function H(t) {
        a = o;
        o = t;
        n = A();
      }
      function O(t, e) {
        return F(t, e) - F(z(t), e);
      }
      function R(t) {
        return X(t) - X(z(t));
      }
      function z(t) {
        return o === t && a || o;
      }
      function F(t, e) {
        return (V(t) ? t.changedTouches[0] : t)["page" + L(e ? "Y" : "X")];
      }
      function V(t) {
        return typeof TouchEvent != "undefined" && t instanceof TouchEvent;
      }
      function W() {
        return c;
      }
      function U(t) {
        u = t;
      }
      return {
        mount: function t() {
          g(k, ec, r, ev);
          g(k, eh, r, ev);
          g(k, ed, P, ev);
          g(k, "click", D, {
            capture: true
          });
          g(k, "dragstart", N);
          f([tc, tv], B);
        },
        disable: U,
        isDragging: W
      };
    },
    Keyboard: function t(e, i, s) {
      var r;
      var o;
      var a = t_(e);
      var l = a.on;
      var d = a.bind;
      var c = a.unbind;
      var h = e.root;
      var u = i.Direction.resolve;
      function p() {
        var t = s.keyboard;
        if (t) {
          d(r = t === "global" ? window : h, eb, g);
        }
      }
      function m() {
        c(r, eb);
      }
      function f(t) {
        o = t;
      }
      function v() {
        var t = o;
        o = true;
        n(function () {
          o = t;
        });
      }
      function g(t) {
        if (!o) {
          var i = ey(t);
          if (i === u(t8)) {
            e.go("<");
          } else if (i === u(tA)) {
            e.go(">");
          }
        }
      }
      return {
        mount: function t() {
          p();
          l(tv, m);
          l(tv, p);
          l(tu, v);
        },
        destroy: m,
        disable: f
      };
    },
    LazyLoad: function t(i, n, r) {
      var o = t_(i);
      var a = o.on;
      var l = o.off;
      var d = o.bind;
      var c = o.emit;
      var h = r.lazyLoad === "sequential";
      var u = [tp, t$];
      var p = [];
      function m() {
        e(p);
        n.Slides.forEach(function (t) {
          W(t.slide, eC).forEach(function (e) {
            var i = H(e, e$);
            var s = H(e, eS);
            if (i !== e.src || s !== e.srcset) {
              var n = r.classes.spinner;
              var o = e.parentElement;
              var a = x(o, "." + n) || P("span", n, o);
              p.push([e, t, a]);
              if (!e.src) {
                q(e, "none");
              }
            }
          });
        });
        if (h) {
          y();
        } else {
          l(u);
          a(u, f);
          f();
        }
      }
      function f() {
        if (!(p = p.filter(function (t) {
          var e = r.perPage * ((r.preloadPages || 1) + 1) - 1;
          return !t[1].isWithin(i.index, e) || v(t);
        })).length) {
          l(u);
        }
      }
      function v(t) {
        var e = t[0];
        $(t[1].slide, er);
        d(e, "load error", s(g, t));
        B(e, "src", H(e, e$));
        B(e, "srcset", H(e, eS));
        M(e, e$);
        M(e, eS);
      }
      function g(t, e) {
        var i = t[0];
        var s = t[1];
        U(s.slide, er);
        if (e.type !== "error") {
          z(t[2]);
          q(i, "");
          c(tx, i, s);
          c(tg);
        }
        if (h) {
          y();
        }
      }
      function y() {
        if (p.length) {
          v(p.shift());
        }
      }
      return {
        mount: function t() {
          if (r.lazyLoad) {
            m();
            a(tf, m);
          }
        },
        destroy: s(e, p),
        check: f
      };
    },
    Pagination: function t(n, r, o) {
      var a;
      var l;
      var d = t_(n);
      var c = d.on;
      var h = d.emit;
      var u = d.bind;
      var p = r.Slides;
      var m = r.Elements;
      var f = r.Controller;
      var v = f.hasFocus;
      var g = f.getIndex;
      var y = f.go;
      var b = r.Direction.resolve;
      var S = m.pagination;
      var C = [];
      function E() {
        k();
        c([tv, tf, "ei"], E);
        var t = o.pagination;
        if (S) {
          q(S, t ? "" : "none");
        }
        if (t) {
          c([tu, tb, t$], A);
          (function t() {
            var e = n.length;
            var i = o.classes;
            var r = o.i18n;
            var d = o.perPage;
            var c = v() ? f.getEnd() + 1 : tt(e / d);
            a = S || P("ul", i.pagination, m.track.parentElement);
            $(a, l = t7 + "--" + L());
            B(a, tP, "tablist");
            B(a, tR, r.select);
            B(a, tN, L() === "ttb" ? "vertical" : "");
            for (var h = 0; h < c; h++) {
              var g = P("li", null, a);
              var y = P("button", {
                class: i.page,
                type: "button"
              }, g);
              var b = p.getIn(h).map(function (t) {
                return t.slide.id;
              });
              var E = !v() && d > 1 ? r.pageX : r.slideX;
              u(y, "click", s(x, h));
              if (o.paginationKeyboard) {
                u(y, "keydown", s(_, h));
              }
              B(g, tP, "presentation");
              B(y, tP, "tab");
              B(y, tD, b.join(" "));
              B(y, tR, to(E, h + 1));
              B(y, tI, -1);
              C.push({
                li: g,
                button: y,
                page: h
              });
            }
          })();
          A();
          h("pagination:mounted", {
            list: a,
            items: C
          }, w(n.index));
        }
      }
      function k() {
        if (a) {
          z(S ? i(a.children) : a);
          U(a, l);
          e(C);
          a = null;
        }
        d.destroy();
      }
      function x(t) {
        y(">" + t, true);
      }
      function _(t, e) {
        var i = C.length;
        var s = ey(e);
        var n = L();
        var r = -1;
        if (s === b(tA, false, n)) {
          r = ++t % i;
        } else if (s === b(t8, false, n)) {
          r = (--t + i) % i;
        } else if (s === "Home") {
          r = 0;
        } else if (s === "End") {
          r = i - 1;
        }
        var o = C[r];
        if (o) {
          D(o.button);
          y(">" + r);
          N(e, true);
        }
      }
      function L() {
        return o.paginationDirection || o.direction;
      }
      function w(t) {
        return C[f.toPage(t)];
      }
      function A() {
        var t = w(g(true));
        var e = w(g());
        if (t) {
          var i = t.button;
          U(i, ee);
          M(i, tO);
          B(i, tI, -1);
        }
        if (e) {
          var s = e.button;
          $(s, ee);
          B(s, tO, true);
          B(s, tI, "");
        }
        h("pagination:updated", {
          list: a,
          items: C
        }, t, e);
      }
      return {
        items: C,
        mount: E,
        destroy: k,
        getAt: w,
        update: A
      };
    },
    Sync: function t(i, n, r) {
      var o = r.isNavigation;
      var a = r.slideFocus;
      var l = [];
      function d() {
        var t;
        var e;
        i.splides.forEach(function (t) {
          if (!t.isParent) {
            h(i, t.splide);
            h(t.splide, i);
          }
        });
        if (o) {
          t = t_(i);
          e = t.on;
          e(tm, m);
          e("sk", f);
          e([tc, tv], p);
          l.push(t);
          t.emit(tC, i.splides);
        }
      }
      function c() {
        l.forEach(function (t) {
          t.destroy();
        });
        e(l);
      }
      function h(t, e) {
        var i = t_(t);
        i.on(tu, function (t, i, s) {
          e.go(e.is(ep) ? s : t);
        });
        l.push(i);
      }
      function p() {
        B(n.Elements.list, tN, r.direction === "ttb" ? "vertical" : "");
      }
      function m(t) {
        i.go(t.index);
      }
      function f(t, e) {
        if (g(eE, ey(e))) {
          m(t);
          N(e);
        }
      }
      return {
        setup: s(n.Media.set, {
          slideFocus: u(a) ? o : a
        }, true),
        mount: d,
        destroy: c,
        remount: function t() {
          c();
          d();
        }
      };
    },
    Wheel: function t(e, i, s) {
      var n = t_(e).bind;
      var r = 0;
      function o(t) {
        if (t.cancelable) {
          var n;
          var o = t.deltaY;
          var a = o < 0;
          var l = X(t);
          var d = s.wheelMinThreshold || 0;
          var c = s.wheelSleep || 0;
          if (te(o) > d && l - r > c) {
            e.go(a ? "<" : ">");
            r = l;
          }
          n = a;
          if (!s.releaseWheel || e.state.is(4) || i.Controller.getAdjacent(n) !== -1) {
            N(t);
          }
        }
      }
      return {
        mount: function t() {
          if (s.wheel) {
            n(i.Elements.track, "wheel", o, ev);
          }
        }
      };
    },
    Live: function t(e, i, n) {
      var r = t_(e).on;
      var o = i.Elements.track;
      var a = n.live && !n.isNavigation;
      var l = P("span", et);
      var d = tL(90, s(c, false));
      function c(t) {
        B(o, t0, t);
        if (t) {
          S(o, l);
          d.start();
        } else {
          z(l);
          d.cancel();
        }
      }
      function h(t) {
        if (a) {
          B(o, tW, t ? "off" : "polite");
        }
      }
      return {
        mount: function t() {
          if (a) {
            h(!i.Autoplay.isPaused());
            B(o, t2, true);
            l.textContent = "…";
            r(tE, s(h, true));
            r(tk, s(h, false));
            r([tp, t$], s(c, true));
          }
        },
        disable: h,
        destroy: function t() {
          M(o, [tW, t2, t0]);
          z(l);
        }
      };
    }
  });
  var ex = {
    type: "slide",
    role: "region",
    speed: 400,
    perPage: 1,
    cloneStatus: true,
    arrows: true,
    pagination: true,
    paginationKeyboard: true,
    interval: 5000,
    pauseOnHover: true,
    pauseOnFocus: true,
    resetProgress: true,
    easing: "cubic-bezier(0.25, 1, 0.5, 1)",
    drag: true,
    direction: "ltr",
    trimSpace: true,
    focusableNodes: "a, button, textarea, input, select, iframe",
    live: true,
    classes: {
      slide: tX,
      clone: tj,
      arrows: tY,
      arrow: t6,
      prev: tK,
      next: t5,
      pagination: t7,
      page: tJ,
      spinner: tU + "spinner"
    },
    i18n: {
      prev: "Previous slide",
      next: "Next slide",
      first: "Go to first slide",
      last: "Go to last slide",
      slideX: "Go to slide %s",
      pageX: "Go to page %s",
      play: "Start autoplay",
      pause: "Pause autoplay",
      carousel: "carousel",
      slide: "slide",
      select: "Select a slide to show",
      slideLabel: "%s of %s"
    },
    reducedMotion: {
      speed: 0,
      rewindSpeed: 0,
      autoplay: "pause"
    }
  };
  function e_(t, e, i) {
    var s = e.Slides;
    function o() {
      s.forEach(function (t) {
        t.style("transform", "translateX(-" + t.index * 100 + "%)");
      });
    }
    return {
      mount: function e() {
        t_(t).on([tc, tf], o);
      },
      start: function t(e, r) {
        s.style("transition", "opacity " + i.speed + "ms " + i.easing);
        n(r);
      },
      cancel: r
    };
  }
  function eL(t, e, i) {
    var n;
    var r = e.Move;
    var o = e.Controller;
    var a = e.Scroll;
    var l = e.Elements.list;
    var d = s(I, l, "transition");
    function c() {
      d("");
      a.cancel();
    }
    return {
      mount: function e() {
        t_(t).bind(l, "transitionend", function (t) {
          if (t.target === l && n) {
            c();
            n();
          }
        });
      },
      start: function e(s, l) {
        var c = r.toPosition(s, true);
        var h = r.getPosition();
        var u = function e(s) {
          var n = i.rewindSpeed;
          if (t.is(eu) && n) {
            var r = o.getIndex(true);
            var a = o.getEnd();
            if (r === 0 && s >= a || r >= a && s === 0) {
              return n;
            }
          }
          return i.speed;
        }(s);
        if (te(c - h) >= 1 && u >= 1) {
          if (i.useScroll) {
            a.scroll(c, u, false, l);
          } else {
            d("transform " + u + "ms " + i.easing);
            r.translate(c, true);
            n = l;
          }
        } else {
          r.jump(s);
          l();
        }
      },
      cancel: c
    };
  }
  var ew = function () {
    function t(e, i) {
      this.event = t_();
      this.Components = {};
      this.state = function t(e) {
        var i = 1;
        function s(t) {
          i = t;
        }
        return {
          set: s,
          is: function t(e) {
            return g(f(e), i);
          }
        };
      }(1);
      this.splides = [];
      this._o = {};
      this._E = {};
      var s = h(e) ? V(document, e) : e;
      K(s, s + " is invalid.");
      this.root = s;
      i = A({
        label: H(s, tR) || "",
        labelledby: H(s, tz) || ""
      }, ex, t.defaults, i || {});
      try {
        A(i, JSON.parse(H(s, Y)));
      } catch (n) {
        K(false, "Invalid JSON");
      }
      this._o = Object.create(A({}, i));
    }
    var s = t.prototype;
    s.mount = function t(e, i) {
      var s = this;
      var n = this.state;
      var r = this.Components;
      K(n.is([1, 7]), "Already mounted!");
      n.set(1);
      this._C = r;
      this._T = i || this._T || (this.is(em) ? e_ : eL);
      this._E = e || this._E;
      var o = w({}, ek, this._E, {
        Transition: this._T
      });
      L(o, function (t, e) {
        var i = t(s, r, s._o);
        r[e] = i;
        if (i.setup) {
          i.setup();
        }
      });
      L(r, function (t) {
        if (t.mount) {
          t.mount();
        }
      });
      this.emit(tc);
      $(this.root, "is-initialized");
      n.set(3);
      this.emit(th);
      return this;
    };
    s.sync = function t(e) {
      this.splides.push({
        splide: e
      });
      e.splides.push({
        splide: this,
        isParent: true
      });
      if (this.state.is(3)) {
        this._C.Sync.remount();
        e.Components.Sync.remount();
      }
      return this;
    };
    s.go = function t(e) {
      this._C.Controller.go(e);
      return this;
    };
    s.on = function t(e, i) {
      this.event.on(e, i);
      return this;
    };
    s.off = function t(e) {
      this.event.off(e);
      return this;
    };
    s.emit = function t(e) {
      var s;
      (s = this.event).emit.apply(s, [e].concat(i(arguments, 1)));
      return this;
    };
    s.add = function t(e, i) {
      this._C.Slides.add(e, i);
      return this;
    };
    s.remove = function t(e) {
      this._C.Slides.remove(e);
      return this;
    };
    s.is = function t(e) {
      return this._o.type === e;
    };
    s.refresh = function t() {
      this.emit(tf);
      return this;
    };
    s.destroy = function t(i = true) {
      var s = this.event;
      var n = this.state;
      if (n.is(1)) {
        t_(this).on(th, this.destroy.bind(this, i));
      } else {
        L(this._C, function (t) {
          if (t.destroy) {
            t.destroy(i);
          }
        }, true);
        s.emit(tS);
        s.destroy();
        if (i) {
          e(this.splides);
        }
        n.set(7);
      }
      return this;
    };
    _createClass(t, [{
      key: "options",
      get: function t() {
        return this._o;
      },
      set: function t(e) {
        this._C.Media.set(e, true, true);
      }
    }, {
      key: "length",
      get: function t() {
        return this._C.Slides.getLength(true);
      }
    }, {
      key: "index",
      get: function t() {
        return this._C.Controller.getIndex();
      }
    }]);
    return t;
  }();
  ew.defaults = {};
  ew.STATES = {
    CREATED: 1,
    MOUNTED: 2,
    IDLE: 3,
    MOVING: 4,
    SCROLLING: 5,
    DRAGGING: 6,
    DESTROYED: 7
  };
  return ew;
});
class SplideComponent extends HTMLElement {
  constructor() {
    super();
    this.sliderContainer = this.querySelector(".splide");
    document.addEventListener("shopify:section:load", t => {
      this.initSlider();
    });
  }
  connectedCallback() {
    this.initSlider();
  }
  initSlider() {
    this.type = this.dataset.type || "slide";
    this.typeMobile = this.dataset.typeMobile || this.type;
    this.direction = this.dataset.direction || defaultDirection;
    this.rewind = this.type === "fade";
    this.autoplay = this.dataset.autoplay === "true";
    this.autoplaySpeed = this.dataset.autoplaySpeed && !isNaN(parseInt(this.dataset.autoplaySpeed)) ? parseInt(this.dataset.autoplaySpeed) * 1000 : 5000;
    this.drag = this.dataset.drag !== "false" && (this.dataset.drag !== "free" || "free");
    this.focus = this.dataset.focus || 0;
    this.trimSpace = this.dataset.trimSpace !== "false";
    this.arrows = this.dataset.arrows !== "false";
    this.arrowsColor = this.dataset.arrowsColor ? ` color-${this.dataset.arrowsColor}` : "";
    this.pagination = this.dataset.pagination !== "false";
    this.omitEnd = this.dataset.omitEnd !== "false";
    this.dotsColor = this.dataset.dotsColor ? ` color-${this.dataset.dotsColor} dots-custom-color` : "";
    this.slidesDesktop = this.dataset.slidesDesktop && !isNaN(parseInt(this.dataset.slidesDesktop)) ? parseInt(this.dataset.slidesDesktop) : 3;
    this.autoWidth = this.dataset.autoWidth === "true";
    this.slidesMobile = this.dataset.slidesMobile && !isNaN(parseInt(this.dataset.slidesMobile)) ? parseInt(this.dataset.slidesMobile) : 1;
    this.perMoveDesktop = this.dataset.perMoveDesktop && !isNaN(parseInt(this.dataset.perMoveDesktop)) ? parseInt(this.dataset.perMoveDesktop) : 1;
    this.perMoveMobile = this.dataset.perMoveMobile && !isNaN(parseInt(this.dataset.perMoveMobile)) ? parseInt(this.dataset.perMoveMobile) : 1;
    this.gapDesktop = this.dataset.gapDesktop ? parseInt(this.dataset.gapDesktop) : 30;
    this.gapMobile = this.dataset.gapMobile ? parseInt(this.dataset.gapMobile) : 15;
    this.paddingCalcDesktop = this.dataset.paddingCalcDesktop === "true";
    this.rightPaddingDesktop = parseInt(this.dataset.sidePaddingDesktop) || 0;
    this.leftPaddingDesktop = this.dataset.paddingCalcDesktop ? 0 : this.rightPaddingDesktop;
    this.paddingCalcMobile = this.dataset.paddingCalcMobile === "true";
    this.rightPaddingMobile = parseInt(this.dataset.sidePaddingMobile) || 0;
    this.leftPaddingMobile = this.paddingCalcMobile ? 0 : this.rightPaddingMobile;
    this.destroyDesktop = this.dataset.destroyDesktop === "true";
    this.destroyMobile = this.dataset.destroyMobile === "true";
    this.config = {
      type: this.type,
      direction: this.direction,
      rewind: this.rewind,
      autoplay: this.autoplay,
      interval: this.autoplaySpeed,
      drag: this.drag,
      focus: this.focus,
      trimSpace: this.trimSpace,
      arrows: this.arrows,
      pagination: this.pagination,
      omitEnd: this.omitEnd,
      perPage: this.slidesDesktop,
      perMove: this.perMoveDesktop,
      autoWidth: this.autoWidth,
      gap: this.gapDesktop,
      paddingCalc: this.paddingCalcDesktop,
      padding: {
        left: this.leftPaddingDesktop,
        right: this.rightPaddingDesktop
      },
      destroy: this.destroyDesktop,
      classes: {
        arrow: `splide__arrow${this.arrowsColor}`,
        page: `splide__pagination__page${this.dotsColor}`
      },
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
      breakpoints: {
        749: {
          omitEnd: this.omitEnd,
          type: this.typeMobile,
          perPage: this.slidesMobile,
          perMove: this.perMoveMobile,
          gap: this.gapMobile,
          paddingCalc: this.paddingCalcMobile,
          padding: {
            left: this.leftPaddingMobile,
            right: this.rightPaddingMobile
          },
          destroy: this.destroyMobile
        }
      }
    };
    let t = new Splide(this.sliderContainer, this.config);
    t.on("mounted", () => {
      let e = t.index;
      let i = t.Components.Elements.slides[e];
      if (i) {
        let s = i.querySelector("img");
        if (s) {
          if (s.complete) {
            i.classList.add("is-instant-active");
            this.setActiveSlideHeight(i);
          } else {
            s.addEventListener("load", () => {
              i.classList.add("is-instant-active");
              this.setActiveSlideHeight(i);
            });
          }
        } else {
          i.classList.add("is-instant-active");
          this.setActiveSlideHeight(i);
        }
      }
      let n = debounce(() => {
        let e = t.Components.Elements.slides[t.index];
        this.setActiveSlideHeight(e);
      }, 200);
      window.addEventListener("resize", n);
    });
    t.on("move", e => {
      let i = t.index;
      let s = t.Components.Elements.slides;
      if (s) {
        let n = s[i];
        if (n) {
          s.forEach(t => t.classList.remove("is-instant-active"));
          n.classList.add("is-instant-active");
          this.setActiveSlideHeight(n);
        }
      }
    });
    if (this.dataset.pauseVideos === "true") {
      t.on("hidden", t => {
        let e = t.slide.querySelector("internal-video");
        if (e) {
          let i = e.dataset.actionOnInactive;
          if (i === "pause") {
            e.video.pause();
            e.classList.remove("internal-video--playing");
          } else if (i === "mute") {
            e.video.muted = true;
            e.classList.add("internal-video--muted");
          }
        }
      });
    }
    t.mount();
  }
  setActiveSlideHeight(t) {
    if (t) {
      let e = t.offsetHeight;
      this.style.setProperty("--active-slide-height", `${e}px`);
    }
  }
}
customElements.define("splide-component", SplideComponent);
class DetailsDisclosure extends HTMLElement {
  constructor() {
    super();
    this.mainDetailsToggle = this.querySelector("details");
    this.content = this.mainDetailsToggle.querySelector("summary").nextElementSibling;
    this.mainDetailsToggle.addEventListener("focusout", this.onFocusOut.bind(this));
    this.mainDetailsToggle.addEventListener("toggle", this.onToggle.bind(this));
  }
  onFocusOut() {
    setTimeout(() => {
      if (!this.contains(document.activeElement)) {
        this.close();
      }
    });
  }
  onToggle() {
    this.animations ||= this.content.getAnimations();
    if (this.mainDetailsToggle.hasAttribute("open")) {
      this.animations.forEach(t => t.play());
    } else {
      this.animations.forEach(t => t.cancel());
    }
  }
  close() {
    this.mainDetailsToggle.removeAttribute("open");
    this.mainDetailsToggle.querySelector("summary").setAttribute("aria-expanded", false);
  }
}
customElements.define("details-disclosure", DetailsDisclosure);
class HeaderMenu extends DetailsDisclosure {
  constructor() {
    super();
    this.header = document.querySelector(".header-wrapper");
  }
  onToggle() {
    if (this.header) {
      this.header.preventHide = this.mainDetailsToggle.open;
      if (document.documentElement.style.getPropertyValue("--header-bottom-position-desktop") === "") {
        document.documentElement.style.setProperty("--header-bottom-position-desktop", `${Math.floor(this.header.getBoundingClientRect().bottom)}px`);
      }
    }
  }
}
customElements.define("header-menu", HeaderMenu);
class DetailsModal extends HTMLElement {
  constructor() {
    super();
    this.detailsContainer = this.querySelector("details");
    this.summaryToggle = this.querySelector("summary");
    this.detailsContainer.addEventListener("keyup", t => t.code.toUpperCase() === "ESCAPE" && this.close());
    this.summaryToggle.addEventListener("click", this.onSummaryClick.bind(this));
    this.querySelector("button[type=\"button\"]").addEventListener("click", this.close.bind(this));
    this.summaryToggle.setAttribute("role", "button");
  }
  isOpen() {
    return this.detailsContainer.hasAttribute("open");
  }
  onSummaryClick(t) {
    t.preventDefault();
    if (t.target.closest("details").hasAttribute("open")) {
      this.close();
    } else {
      this.open(t);
    }
  }
  onBodyClick(t) {
    if (!this.contains(t.target) || t.target.classList.contains("modal-overlay")) {
      this.close(false);
    }
  }
  open(t) {
    this.onBodyClickEvent = this.onBodyClickEvent || this.onBodyClick.bind(this);
    t.target.closest("details").setAttribute("open", true);
    document.body.addEventListener("click", this.onBodyClickEvent);
    document.body.classList.add("overflow-hidden");
    if (typeof trapFocus == "function") {
      trapFocus(this.detailsContainer.querySelector("[tabindex=\"-1\"]"), this.detailsContainer.querySelector("input:not([type=\"hidden\"])"));
    }
  }
  close(t = true) {
    if (typeof removeTrapFocus == "function") {
      removeTrapFocus(t ? this.summaryToggle : null);
    }
    this.detailsContainer.removeAttribute("open");
    document.body.removeEventListener("click", this.onBodyClickEvent);
    document.body.classList.remove("overflow-hidden");
  }
}
customElements.define("details-modal", DetailsModal);
let hotspotButtons = [];
function registerHotspotButton(t) {
  hotspotButtons.push(t);
}
function unregisterHotspotButton(t) {
  let e = hotspotButtons.indexOf(t);
  if (e !== -1) {
    hotspotButtons.splice(e, 1);
  }
}
document.addEventListener("mousedown", function (t) {
  for (let e of hotspotButtons) {
    if (e.dataset.open === "true" && !e.contains(t.target)) {
      e.closeModal();
    }
  }
});
class HotspotButton extends HTMLElement {
  constructor() {
    super();
    this.button = this.querySelector(".hotspot-btn");
    this.content = this.querySelector(".hotspot__content");
    this.type = this.dataset.type;
    this.openEvent = this.dataset.openEvent;
    this.header = document.querySelector(".section-header");
    this.stickyHeader = document.querySelector("sticky-header");
    this.mobileOverlay = this.querySelector(".hotspot-overlay");
    this.button.addEventListener("click", this.toggleModal.bind(this));
    if (this.openEvent === "hover" && window.matchMedia("(hover: hover)").matches && window.matchMedia("(pointer: fine)").matches) {
      this.button.addEventListener("mouseover", this.openModal.bind(this));
      this.button.addEventListener("mouseout", this.startCheckingMouseLeave.bind(this));
      this.content.addEventListener("mouseover", this.stopCheckingMouseLeave.bind(this));
      this.content.addEventListener("mouseout", this.startCheckingMouseLeave.bind(this));
    }
    if (this.mobileOverlay) {
      this.mobileOverlay.addEventListener("click", this.closeModal.bind(this));
    }
  }
  startCheckingMouseLeave() {
    this.checkingMouseLeave = true;
    setTimeout(() => {
      if (this.checkingMouseLeave) {
        this.closeModal();
      }
    }, 200);
  }
  stopCheckingMouseLeave() {
    this.checkingMouseLeave = false;
  }
  toggleModal() {
    if (this.dataset.open != "true") {
      this.openModal();
    }
  }
  openModal() {
    let t = this.header.clientHeight;
    if (this.header.classList.contains("shopify-section-header-hidden") || !this.stickyHeader) {
      t = 0;
    }
    if (this.content.getBoundingClientRect().top - t < 0) {
      this.dataset.direction = "bottom";
    }
    this.dataset.open = "true";
  }
  closeModal() {
    this.dataset.open = "false";
    setTimeout(() => {
      this.dataset.direction = "";
    }, 100);
  }
  connectedCallback() {
    registerHotspotButton(this);
  }
  disconnectedCallback() {
    unregisterHotspotButton(this);
  }
}
customElements.define("hotspot-button", HotspotButton);
class ParallaxHero extends HTMLElement {
  constructor() {
    super();
    this.overlays = this.querySelectorAll(".parallax-hero__layer");
    this.animateOnEnter = this.dataset.animationStart === "bottom";
    this.handleScroll();
    window.addEventListener("scroll", () => requestAnimationFrame(this.handleScroll.bind(this)));
  }
  handleScroll(t) {
    var {
      top: e,
      left: i,
      height: s
    } = this.getBoundingClientRect();
    let n = window.innerHeight;
    let r;
    if (this.animateOnEnter) {
      if (e > n || e + s < 0) {
        return;
      }
      r = Math.min((n - e) / (n + s), 1);
    } else {
      if (e > n || e + s < 0) {
        return;
      }
      let o = e >= 0 ? 0 : -e;
      if (o > s) {
        return;
      }
      r = Math.min(o / s, 1);
    }
    this.overlays.forEach(t => {
      let i = e * (parseInt(t.dataset.scrollY) / 100);
      let s = parseInt(t.dataset.scrollX) * r;
      let n = 100 + (parseInt(t.dataset.zoom) - 100) * r;
      let o = parseInt(t.dataset.rotation) * 3.6 * r;
      t.style.transform = `translateY(${i}px) translateX(${s}%) scale(${n / 100}) rotate(${o}deg)`;
    });
  }
}
customElements.define("parallax-hero", ParallaxHero);
class ContentTabs extends HTMLElement {
  constructor() {
    super();
    this.activeButtonClass = this.dataset.productTabs == "true" ? "active" : "content-tab-button--active";
    this.buttons = this.querySelectorAll(".content-tab-button-js");
    this.tabs = this.querySelectorAll(".content-tab");
    this.tabsContainer = this.querySelector(".content-tabs__tabs-js");
    this.activeButton = this.querySelector(`.${this.activeButtonClass}`);
    this.activeTab = this.querySelector(".content-tab--active");
    this.isMovingAnimation = this.dataset.animation === "moving";
    if (this.isMovingAnimation) {
      this.activeBg = this.querySelector(".content-tab-buttom__active-bg");
      this.handleActiveBg();
      this.activeBg.style.transitionDuration = "0.4s";
    }
    this.setHeight();
    this.buttons.forEach(t => {
      t.addEventListener("click", this.handleClick.bind(this));
    });
    window.addEventListener("resize", () => {
      this.setHeight();
      if (this.isMovingAnimation) {
        this.handleActiveBg();
      }
    });
  }
  handleClick(t) {
    this.activeButton = t.currentTarget;
    this.buttons.forEach(t => {
      t.classList.remove(this.activeButtonClass);
    });
    this.activeButton.classList.add(this.activeButtonClass);
    this.tabs.forEach(t => {
      t.classList.remove("content-tab--active");
      if (t.dataset.index === this.activeButton.dataset.index) {
        this.activeTab = t;
      }
    });
    this.activeTab.classList.add("content-tab--active");
    this.setHeight();
    if (this.isMovingAnimation) {
      this.handleActiveBg();
    }
  }
  setHeight() {
    if (this.activeTab) {
      this.tabsContainer.style.height = this.activeTab.clientHeight + "px";
    }
  }
  handleActiveBg() {
    this.activeBg.style.width = this.activeButton.getBoundingClientRect().width + "px";
    this.activeBg.style.height = this.activeButton.getBoundingClientRect().height + "px";
    this.activeBg.style.top = this.activeButton.offsetTop + "px";
    this.activeBg.style.left = this.activeButton.offsetLeft + "px";
  }
}
customElements.define("content-tabs", ContentTabs);
class InstaStories extends HTMLElement {
  constructor() {
    super();
    this.openButtons = this.querySelectorAll(".insta-story-open-btn");
    this.openButtonsOverflowContainer = this.querySelector(".insta-stories__open-buttons-container");
    this.openButtonsContainer = this.querySelector(".insta-stories__open-buttons");
    this.openBtnsPrev = this.querySelector(".insta-stories__open-btns-prev");
    this.openBtnsNext = this.querySelector(".insta-stories__open-btns-next");
    this.closeButtons = this.querySelectorAll(".insta-stories__close-button");
    this.modal = this.querySelector(".insta-stories__modal");
    this.modalOpen = false;
    this.slider = this.querySelector(".insta-stories__slider");
    this.stories = this.querySelectorAll(".insta-story");
    this.prevBtns = this.querySelectorAll(".insta-story__prev");
    this.nextBtns = this.querySelectorAll(".insta-story__next");
    this.slideBtns = this.querySelectorAll(".insta-story__slide-btn");
    this.activeIndex = 0;
    this.activeStory = this.stories[this.activeIndex];
    this.lastIndex = parseInt(this.dataset.lastIndex);
    this.pauseResumeBtns = this.querySelectorAll(".insta-story__pause-resume-btn");
    this.isPaused = false;
    this.volumeBtns = this.querySelectorAll(".insta-story__volume-btn");
    this.isMuted = true;
    this.initStories();
    this.initButtonsSlider();
    this.openButtons.forEach(t => {
      t.addEventListener("click", this.openModal.bind(this));
    });
    this.closeButtons.forEach(t => {
      t.addEventListener("click", this.closeModal.bind(this));
    });
    this.prevBtns.forEach(t => {
      t.addEventListener("click", this.storyPrevBtnClick.bind(this));
    });
    this.nextBtns.forEach(t => {
      t.addEventListener("click", this.storyNextBtnClick.bind(this));
    });
    this.slideBtns.forEach(t => {
      t.addEventListener("click", this.slideBtnClick.bind(this));
    });
    this.pauseResumeBtns.forEach(t => {
      t.addEventListener("click", this.togglePauseResume.bind(this));
    });
    this.volumeBtns.forEach(t => {
      t.addEventListener("click", this.toggleIsMuted.bind(this));
    });
    this.slider.addEventListener("touchstart", this.touchStartHandler.bind(this));
    this.slider.addEventListener("touchend", this.touchEndHandler.bind(this));
    document.addEventListener("keydown", t => {
      if (this.modalOpen) {
        switch (t.key) {
          case "Escape":
            this.closeModal();
            break;
          case "ArrowLeft":
            this.storyPrevBtnClick();
            break;
          case "ArrowRight":
            this.storyNextBtnClick();
        }
      }
    });
    if (Shopify.designMode) {
      document.addEventListener("shopify:section:load", () => {
        this.initStories();
        this.initButtonsSlider();
      });
      document.addEventListener("shopify:section:reorder", () => {
        this.initStories();
        this.initButtonsSlider();
      });
    }
  }
  autoplay() {
    let t = this.activeStory;
    let e = parseInt(t.dataset.activeMediaIndex);
    let i = t.querySelectorAll(".insta-story__media")[e];
    let s = parseInt(i.getAttribute("data-duration")) * 1000;
    this.updateProgressBars(e);
    this.autoplayStartTime = Date.now();
    this.autoplayTimeout = setTimeout(() => {
      this.storyNextBtnClick();
    }, s);
  }
  storyPrevBtnClick() {
    let t = this.activeStory;
    if (t.dataset.activeMediaIndex === "0") {
      this.changeActiveStory(this.activeIndex - 1);
    } else {
      this.changeActiveMedia(parseInt(t.dataset.activeMediaIndex) - 1);
    }
  }
  storyNextBtnClick() {
    let t = this.activeStory;
    if (t.dataset.activeMediaIndex === t.dataset.lastMediaIndex) {
      this.changeActiveStory(this.activeIndex + 1);
    } else {
      this.changeActiveMedia(parseInt(t.dataset.activeMediaIndex) + 1);
    }
  }
  slideBtnClick(t) {
    let e = parseInt(t.currentTarget.dataset.index);
    this.changeActiveStory(e);
  }
  changeActiveStory(t) {
    clearTimeout(this.autoplayTimeout);
    if (t > this.lastIndex || t < 0) {
      return;
    }
    let e = this.stories[this.activeIndex];
    e.classList.remove("internal-video--loading");
    let i = parseInt(e.dataset.activeMediaIndex);
    if (e.dataset.played === "true" || i > 0) {
      let s = e.querySelectorAll(".insta-story__progress-item")[i];
      if (s) {
        s.classList.remove("insta-story__progress-item--active");
        if (t > this.activeIndex) {
          s.classList.add("insta-story__progress-item--completed");
        }
      }
    }
    let n = e.querySelectorAll(".insta-story__media")[i];
    if (n && n.getAttribute("data-type") === "video") {
      let r = n.querySelector("video");
      if (r) {
        r.pause();
        if (!this.isPaused || this.bufferPaused) {
          r.currentTime = 0;
        }
      }
    }
    this.activeIndex = t;
    this.activeStory = this.stories[this.activeIndex];
    this.stories.forEach(t => {
      t.classList.remove("insta-story--active");
    });
    this.activeStory.classList.add("insta-story--active");
    this.activeStory.classList.remove("internal-video--loading");
    this.activeStory.dataset.played = "true";
    this.slider.style.transform = `translateX(calc(var(--story-width) * ${this.activeIndex * (isRtl ? 1 : -1)}))`;
    let o = parseInt(this.activeStory.dataset.activeMediaIndex, 10);
    this.changeActiveMedia(o);
    this.updateProgressBars(o);
  }
  changeActiveMedia(t) {
    if (this.bufferPaused && this.isPaused) {
      this.resumeStory();
    }
    clearTimeout(this.autoplayTimeout);
    if (t < 0) {
      return;
    }
    let e = this.activeStory;
    let i = parseInt(e.dataset.lastMediaIndex);
    if (t > i) {
      return;
    }
    if (this.currentVideoEl) {
      this.currentVideoEl.removeEventListener("waiting", this._onBuffer);
      this.currentVideoEl.removeEventListener("playing", this._onResume);
      this.currentVideoEl = null;
    }
    e.dataset.activeMediaIndex = t;
    let s = e.querySelectorAll(".insta-story__media");
    for (let n = 0; n < s.length; n++) {
      let r = s[n];
      let o = r.querySelector("video");
      if (n === t) {
        r.style.display = "block";
        if (r.getAttribute("data-type") === "video" && o) {
          if (!this.isPaused) {
            o.play();
          }
          this._onBuffer = () => {
            if (!this.isPaused) {
              this.pauseStory(true);
            }
            this.bufferPaused = true;
            e.classList.add("internal-video--loading");
          };
          this._onResume = () => {
            if (this.isPaused) {
              this.resumeStory();
            }
            this.bufferPaused = false;
            e.classList.remove("internal-video--loading");
          };
          o.addEventListener("waiting", this._onBuffer);
          o.addEventListener("playing", this._onResume);
          this.currentVideoEl = o;
        }
        e.querySelector(".insta-story__time-posted").innerHTML = r.dataset.timePosted;
      } else {
        r.style.display = "";
        if (r.getAttribute("data-type") === "video" && o) {
          o.pause();
          if (!this.isPaused || this.bufferPaused) {
            o.currentTime = 0;
          }
        }
      }
    }
    this.updateProgressBars(t);
    if (!this.isPaused) {
      this.autoplay();
    }
    let a = e.querySelectorAll(".insta-story__prev");
    let l = e.querySelectorAll(".insta-story__next");
    a.forEach(e => {
      e.toggleAttribute("disabled", this.activeIndex === 0 && t === 0);
    });
    l.forEach(e => {
      e.toggleAttribute("disabled", this.activeIndex === this.lastIndex && t === i);
    });
  }
  updateProgressBars(t) {
    let e = this.activeStory;
    let i = e.querySelectorAll(".insta-story__progress-item");
    i.forEach((e, i) => {
      e.classList.remove("insta-story__progress-item--completed", "insta-story__progress-item--active");
      if (i < t) {
        e.classList.add("insta-story__progress-item--completed");
      } else if (i === t) {
        e.classList.add("insta-story__progress-item--active");
      }
    });
  }
  openModal(t) {
    window.scrollBy(0, -1);
    this.modal.dataset.open = "true";
    this.modalOpen = true;
    document.body.classList.add("overflow-hidden");
    this.changeActiveStory(parseInt(t.currentTarget.dataset.index));
  }
  closeModal(t) {
    this.querySelectorAll("video").forEach(t => {
      t.pause();
    });
    this.modal.dataset.open = "false";
    this.modalOpen = false;
    document.body.classList.remove("overflow-hidden");
    clearTimeout(this.autoplayTimeout);
  }
  initButtonsSlider() {
    if (this.openButtonsOverflowContainer.clientWidth > this.openButtonsContainer.clientWidth) {
      return;
    }
    let t = () => "ontouchstart" in window || navigator.maxTouchPoints;
    let e;
    let i = 0;
    let s = 0;
    let n = t => {
      this.openButtonsContainer.style.transform = `translateX(${t}px)`;
      i = t;
    };
    this.openButtonsOverflowContainer.addEventListener("touchstart", t => {
      this.isDragging = true;
      e = t.touches[0].clientX - s;
    });
    this.openButtonsOverflowContainer.addEventListener("touchmove", t => {
      if (!this.isDragging) {
        return;
      }
      let i = t.touches[0].clientX;
      let s = i - e;
      if (s < 0 && Math.abs(s) <= this.openButtonsContainer.offsetWidth - this.openButtonsOverflowContainer.offsetWidth) {
        n(s);
      }
    });
    this.openButtonsOverflowContainer.addEventListener("touchend", () => {
      this.isDragging = false;
      s = i;
    });
    let r = parseFloat(getComputedStyle(this.openButtons[0]).width);
    let o = parseFloat(getComputedStyle(this.openButtonsContainer).columnGap);
    let a = () => {
      let t = Math.floor(this.openButtonsOverflowContainer.clientWidth / (r + o));
      return (t - 1) * (r + o);
    };
    let l = isRtl ? -1 : 1;
    let d = () => {
      let t = this.openButtonsOverflowContainer.scrollLeft * l;
      this.openBtnsPrev.style.display = t <= 0 ? "none" : "grid";
      this.openBtnsNext.style.display = t > this.openButtonsOverflowContainer.scrollWidth - this.openButtonsContainer.clientWidth ? "none" : "grid";
    };
    this.openBtnsPrev.addEventListener("click", () => {
      this.openButtonsOverflowContainer.scrollBy({
        left: -a() * l,
        behavior: "smooth"
      });
      setTimeout(d, 300);
    });
    this.openBtnsNext.addEventListener("click", () => {
      this.openButtonsOverflowContainer.scrollBy({
        left: a() * l,
        behavior: "smooth"
      });
      setTimeout(d, 300);
    });
    d();
    if (t()) {
      this.openBtnsPrev.style.display = "none";
      this.openBtnsNext.style.display = "none";
    }
    window.addEventListener("resize", debounce(() => {
      if (this.openButtonsOverflowContainer.clientWidth <= this.openButtonsContainer.clientWidth) {
        if (t()) {
          this.openBtnsPrev.style.display = "none";
          this.openBtnsNext.style.display = "none";
        } else {
          d();
        }
      } else {
        this.openBtnsPrev.style.display = "none";
        this.openBtnsNext.style.display = "none";
      }
    }, 250));
  }
  initStories() {
    this.stories.forEach(t => {
      let e = t.querySelectorAll(".insta-story__media");
      t.dataset.lastMediaIndex = e.length - 1;
      t.dataset.played = "false";
      let i = t.querySelector(".insta-story__progress");
      for (let s = 0; s < e.length; s++) {
        let n = e[s].getAttribute("data-duration");
        let r = document.createElement("span");
        r.className = "insta-story__progress-item";
        r.style.setProperty("--duration", `${n}s`);
        let o = document.createElement("span");
        o.className = "insta-story__progress-bar";
        r.appendChild(o);
        i.appendChild(r);
      }
      let a = parseInt(t.dataset.activeMediaIndex);
      if (e[a]) {
        e[a].style.display = "block";
      }
    });
  }
  togglePauseResume(t) {
    let e = t.currentTarget.getAttribute("data-paused") === "true";
    if (e) {
      this.resumeStory();
    } else {
      this.pauseStory();
    }
    this.pauseResumeBtns.forEach(t => {
      t.setAttribute("data-paused", e ? "false" : "true");
    });
  }
  pauseStory(t = false) {
    this.isPaused = true;
    let e = this.activeStory.querySelectorAll(".insta-story__media")[parseInt(this.activeStory.dataset.activeMediaIndex)];
    let i = parseInt(e.getAttribute("data-duration")) * 1000;
    this.remainingTime = i - (Date.now() - this.autoplayStartTime);
    clearTimeout(this.autoplayTimeout);
    if (e.getAttribute("data-type") === "video" && !t) {
      let s = e.querySelector("video");
      if (s) {
        s.pause();
      }
    }
    let n = this.querySelectorAll(".insta-story__progress-bar");
    n.forEach(t => {
      t.style.animationPlayState = "paused";
    });
  }
  resumeStory() {
    this.isPaused = false;
    let t = this.querySelectorAll(".insta-story__progress-bar");
    t.forEach(t => {
      t.style.animationPlayState = "running";
    });
    let e = this.activeStory.querySelectorAll(".insta-story__media")[parseInt(this.activeStory.dataset.activeMediaIndex)];
    if (e.getAttribute("data-type") === "video") {
      let i = e.querySelector("video");
      if (i) {
        i.play();
      }
    }
    this.autoplayStartTime = Date.now();
    this.autoplayTimeout = setTimeout(() => {
      this.storyNextBtnClick();
    }, this.remainingTime);
  }
  toggleIsMuted(t) {
    t.currentTarget;
    this.isMuted = !this.isMuted;
    let e = this.querySelectorAll("video");
    e.forEach(t => {
      t.muted = this.isMuted;
    });
    this.volumeBtns.forEach(t => {
      if (this.isMuted) {
        t.setAttribute("data-muted", "true");
      } else {
        t.setAttribute("data-muted", "false");
      }
    });
  }
  touchStartHandler(t) {
    this.touchStartX = t.touches[0].clientX;
  }
  touchEndHandler(t) {
    let e = t.changedTouches[0].clientX;
    let i = e - this.touchStartX;
    if (Math.abs(i) < 50) {
      return;
    }
    let s = isRtl ? -1 : 1;
    if (i < 0) {
      if (this.activeIndex < this.lastIndex) {
        this.changeActiveStory(this.activeIndex + s);
      }
    } else if (this.activeIndex > 0) {
      this.changeActiveStory(this.activeIndex - s);
    }
  }
}
customElements.define("insta-stories", InstaStories);
class TncCheckbox extends HTMLElement {
  constructor() {
    super();
    this.checked = false;
    let t = this.dataset.target || "#CartDrawer-Checkout";
    this.checkoutButton = document.querySelector(t) || this.closest("form")?.querySelector("button[type=\"submit\"], .button");
    this.disableButton = this.dataset.disableButton === "true";
    this.warningText = this.dataset.warningText;
    this.warningTextElement = document.querySelector(`.tnc-checkbox-warning--${this.dataset.warningPosition}-${this.dataset.section}`);
    if (!this.checkoutButton || !this.warningTextElement) {
      return;
    }
    if (this.warningTextElement) {
      this.warningTextElement.innerHTML = this.warningText;
    }
    if (this.disableButton) {
      this.checkoutButton.classList.add("disabled");
    }
    this.addEventListener("click", this.handleCheckboxClick.bind(this));
    this.checkoutButton.addEventListener("click", this.handleButtonClick.bind(this));
  }
  handleCheckboxClick() {
    this.checked = !this.checked;
    this.dataset.checked = this.checked;
    if (this.checked) {
      this.warningTextElement.classList.add("hidden");
      if (this.disableButton) {
        this.checkoutButton.classList.remove("disabled");
      }
    } else if (this.disableButton) {
      this.checkoutButton.classList.add("disabled");
    }
  }
  handleButtonClick(t) {
    if (this.checked !== true) {
      t.preventDefault();
      this.warningTextElement.classList.remove("hidden");
    }
  }
}
customElements.define("tnc-chekcbox", TncCheckbox);
class ContactForm extends HTMLElement {
  constructor() {
    super();
    this.handleFormSubmit = this.handleFormSubmit.bind(this);
    this.handleFieldInput = this.handleFieldInput.bind(this);
    this.button = this.querySelector(".button");
    this.tnc = this.querySelector(".tnc-checkbox");
  }
  connectedCallback() {
    this.form = this.querySelector("form");
    if (this.form) {
      this.requiredFields = Array.from(this.querySelectorAll(".field-wrapper[data-required=\"true\"]"));
      if (this.requiredFields.length > 0) {
        this.form.addEventListener("submit", this.handleFormSubmit);
        this.requiredFields.forEach(t => {
          let e = t.querySelector(".field__input, .text-area");
          if (e) {
            e.addEventListener("input", this.handleFieldInput);
          }
        });
      }
    }
  }
  disconnectedCallback() {
    if (this.form) {
      this.form.removeEventListener("submit", this.handleFormSubmit);
    }
    this.requiredFields.forEach(t => {
      let e = t.querySelector(".field__input, .text-area");
      if (e) {
        e.removeEventListener("input", this.handleFieldInput);
      }
    });
  }
  handleFormSubmit(t) {
    if (this.button) {
      this.button.disabled = true;
      this.button.classList.add("loading");
    }
    let e = true;
    if (this.tnc && this.tnc.dataset.checked !== "true") {
      e = false;
      let i = document.querySelector(`.tnc-checkbox-warning--${tnc.dataset.warningPosition}-${tnc.dataset.section}`);
      if (i) {
        i.classList.remove("hidden");
      }
    }
    this.requiredFields.forEach(t => {
      let i = t.querySelector(".field__input, .text-area");
      let s = t.querySelector(".field-wrapper__error-msg");
      if (i && !i.value.trim()) {
        e = false;
        t.classList.add("field-wrapper--error");
        if (s) {
          s.classList.remove("hidden");
        }
      }
    });
    if (!e) {
      if (this.button) {
        this.button.disabled = false;
        this.button.classList.remove("loading");
      }
      t.preventDefault();
      t.stopImmediatePropagation();
      return false;
    }
  }
  handleFieldInput(t) {
    let e = t.target;
    let i = e.closest(".field-wrapper");
    let s = i.querySelector(".field-wrapper__error-msg");
    i.classList.remove("field-wrapper--error");
    if (s) {
      s.classList.add("hidden");
    }
  }
}
customElements.define("contact-form", ContactForm);
class PopupCopyButton extends CopyButton {
  constructor() {
    super();
    this.copySuccessMsg = document.querySelector(".popup-modal__success-msg");
  }
  handleClick(t) {
    this.textarea.select();
    document.execCommand("copy");
    this.copySuccessMsg.style.display = "block";
  }
}
customElements.define("popup-copy-button", PopupCopyButton);
class PageScrollProgress extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector(".page-progress__track");
    this.fill = this.querySelector(".page-progress__fill");
    this.update = this.update.bind(this);
    window.addEventListener("scroll", this.update);
    window.addEventListener("resize", this.update);
    this.update();
  }
  update() {
    let t = document.documentElement;
    let e = window.pageYOffset || t.scrollTop;
    let i = t.scrollHeight - t.clientHeight;
    this.fill.style.width = (i > 0 ? Math.round(e / i * 100) : 0) + "%";
  }
}
customElements.define("page-scroll-progress", PageScrollProgress);
class DateCountdownTimer extends HTMLElement {
  connectedCallback() {
    this.update = this.update.bind(this);
    this.wrapper = this.closest(".countdown-wrapper");
    if (!this.wrapper) {
      return;
    }
    let t = (this.wrapper.dataset.endTime || "").trim();
    let e = this.wrapper.dataset.timezone;
    let i = parseInt(this.wrapper.dataset.utcOffset) || 0;
    this.behavior = this.wrapper.dataset.endBehavior;
    this.repeatHours = parseInt(this.wrapper.dataset.repeatHours) || 24;
    this.labels = {
      days: this.wrapper.dataset.labelDays,
      hours: this.wrapper.dataset.labelHours,
      minutes: this.wrapper.dataset.labelMinutes,
      seconds: this.wrapper.dataset.labelSeconds
    };
    this.units = {
      days: this.wrapper.dataset.showDays === "true",
      hours: this.wrapper.dataset.showHours === "true",
      minutes: this.wrapper.dataset.showMinutes === "true",
      seconds: this.wrapper.dataset.showSeconds === "true"
    };
    this.timerStyle = this.dataset.style;
    this.endTime = this.parseEndTime(t, e, i);
    if (!(this.endTime instanceof Date) || isNaN(this.endTime.getTime())) {
      this.wrapper.style.display = "none";
      return;
    }
    this.timer = setInterval(this.update, 1000);
    this.update();
  }
  parseEndTime(t, e, i) {
    let s = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!s) {
      let n = new Date(t.replace(/-/g, "/"));
      return n;
    }
    let r = parseInt(s[1], 10);
    let o = parseInt(s[2], 10) - 1;
    let a = parseInt(s[3], 10);
    let l = parseInt(s[4], 10);
    let d = parseInt(s[5], 10);
    let c = parseInt(s[6] || "0", 10);
    if (e !== "fixed") {
      return new Date(r, o, a, l, d, c);
    }
    {
      let h = Date.UTC(r, o, a, l, d, c) - i * 3600000;
      return new Date(h);
    }
  }
  update() {
    let t = new Date();
    let e = Math.floor((this.endTime - t) / 1000);
    if (!isFinite(e)) {
      return;
    }
    if (e <= 0) {
      if (this.behavior === "hide") {
        this.wrapper.style.display = "none";
        clearInterval(this.timer);
        return;
      }
      if (this.behavior === "restart") {
        let i = new Date(this.endTime);
        let s = this.repeatHours * 3600000;
        while (i <= t) {
          i = new Date(i.getTime() + s);
        }
        this.endTime = i;
        e = Math.floor((this.endTime - t) / 1000);
      } else if (this.behavior === "next_day") {
        let n = new Date(this.endTime);
        while (n <= t) {
          n.setDate(n.getDate() + 1);
        }
        this.endTime = n;
        e = Math.floor((this.endTime - t) / 1000);
      }
    }
    let r = Math.floor(e / 86400);
    let o = Math.floor(e % 86400 / 3600);
    let a = Math.floor(e % 3600 / 60);
    let l = e % 60;
    let d = {
      days: r,
      hours: o,
      minutes: a,
      seconds: l
    };
    Object.keys(this.units).forEach(t => {
      if (!this.units[t]) {
        return;
      }
      let e = this.querySelector(`[aria-label="${t === "days" ? "Day" : t === "hours" ? "Hour" : t === "minutes" ? "Minute" : "Second"}"]`);
      if (!e) {
        return;
      }
      let i = e.querySelector(".countdown-timer__number");
      if (!i) {
        return;
      }
      let s = String(d[t]).padStart(2, "0");
      if (this.timerStyle === "4") {
        i.innerHTML = "";
        s.split("").forEach(t => {
          let e = document.createElement("span");
          e.className = "countdown-timer__digit";
          e.textContent = t;
          i.appendChild(e);
        });
      } else {
        i.textContent = s;
      }
      i.setAttribute("aria-label", `${d[t]} ${this.labels[t]}`);
    });
  }
  disconnectedCallback() {
    clearInterval(this.timer);
  }
}
customElements.define("date-countdown-timer", DateCountdownTimer);
class LocalizationForm extends HTMLElement {
  constructor() {
    super();
    this.elements = {
      input: this.querySelector("input[name=\"locale_code\"], input[name=\"country_code\"]"),
      button: this.querySelector("button"),
      panel: this.querySelector(".disclosure__list-wrapper")
    };
    this.elements.button.addEventListener("click", this.openSelector.bind(this));
    this.addEventListener("keyup", this.onContainerKeyUp.bind(this));
    this.querySelectorAll("a").forEach(t => t.addEventListener("click", this.onItemClick.bind(this)));
    document.addEventListener("click", this.handleClickOutside.bind(this));
  }
  hidePanel() {
    this.elements.button.setAttribute("aria-expanded", "false");
    this.elements.panel.setAttribute("hidden", true);
  }
  onContainerKeyUp(t) {
    if (t.code.toUpperCase() === "ESCAPE") {
      this.hidePanel();
      this.elements.button.focus();
    }
  }
  onItemClick(t) {
    t.preventDefault();
    let e = this.querySelector("form");
    this.elements.input.value = t.currentTarget.dataset.value;
    if (e) {
      e.submit();
    }
  }
  openSelector() {
    this.elements.button.focus();
    this.elements.panel.toggleAttribute("hidden");
    this.elements.button.setAttribute("aria-expanded", (this.elements.button.getAttribute("aria-expanded") === "false").toString());
  }
  handleClickOutside(t) {
    if (!this.contains(t.target)) {
      this.hidePanel();
    }
  }
}
customElements.define("localization-form", LocalizationForm);
class ResultsContainer extends HTMLElement {
  constructor() {
    super();
    this.styleType = this.dataset.style;
    this.duration = parseInt(this.dataset.duration, 10) || 650;
    this.initDelay = parseInt(this.dataset.delay, 10) || 0;
    this.observer = new IntersectionObserver(t => {
      t.forEach(t => {
        if (t.isIntersecting) {
          setTimeout(() => this.animateAll(), this.initDelay);
          this.observer.disconnect();
        }
      });
    }, {
      threshold: 0.3
    });
  }
  connectedCallback() {
    this.observer.observe(this);
  }
  animateAll() {
    let t = this.querySelectorAll(".results__percentage");
    t.forEach(t => {
      let e = parseInt(t.dataset.percentage, 10) || 0;
      this.animateRow(t, e);
    });
  }
  animateRow(t, e) {
    let i = t.querySelector("p");
    let s = performance.now();
    if (this.styleType === "circle") {
      let n = t.querySelector(".ring__prog");
      if (n) {
        requestAnimationFrame(() => {
          n.setAttribute("stroke-dasharray", `${e} 100`);
        });
      }
    }
    let r = t => {
      let n = Math.min((t - s) / this.duration, 1);
      if (i) {
        i.textContent = `${Math.round(n * e)}%`;
      }
      if (n < 1) {
        requestAnimationFrame(r);
      }
    };
    requestAnimationFrame(r);
  }
}
customElements.define("results-container", ResultsContainer);
class DbtfyPrimeTimeline extends HTMLElement {
  connectedCallback() {
    this.direction = this.dataset.direction || "vertical";
    this.styleVertical = this.dataset.styleVertical || "classic";
    this.styleHorizontal = this.dataset.styleHorizontal || "classic";
    this.animateVertical = this.dataset.animateVertical === "true";
    this.animateHorizontal = this.dataset.animateHorizontal === "true";
    this.pointAnimMs = Math.max(0, parseFloat(this.dataset.pointAnimationDuration || "0")) * 1000;
    this.lineAnimMs = Math.max(0, parseFloat(this.dataset.lineAnimationDuration || "0")) * 1000;
    this.stepDelayMs = this.pointAnimMs + this.lineAnimMs;
    this.timelineRoot = this.querySelector(".timeline") || this;
    this.itemsContainer = this.querySelector(".timeline__items");
    this.items = Array.from(this.querySelectorAll(".timeline__item"));
    this.activeContentOutlet = this.querySelector("[data-active-outlet]");
    this.sliderComponent = this.querySelector("timeline-slider");
    if (this.itemsContainer && this.items.length !== 0) {
      this.items.forEach((t, e) => t.dataset.index = String(e));
      this.activeIndex = 0;
      this.dataset.mode = this.direction === "vertical" ? this.styleVertical : this.styleHorizontal;
      this._suppressScroll = false;
      this._restoreTimer = null;
      this.activeTransitionMs = Math.max(0, parseFloat(this.dataset.activeTransitionDuration || "0.25")) * 1000;
      this._activeContentTimer = null;
      if (this.direction === "vertical") {
        this.alignMarkersToHeaders();
        let t = debounce(() => {
          this.alignMarkersToHeaders();
        }, 200);
        window.addEventListener("resize", t);
        this.initVertical();
      } else if (this.direction === "horizontal") {
        this.initHorizontal();
      }
    }
  }
  initVertical() {
    switch (this.styleVertical) {
      case "classic":
        this.initClassicMode(this.animateVertical);
        break;
      case "scroll_activated":
        this.initVerticalScrollActivated();
        break;
      case "accordion":
        this.initVerticalAccordion();
    }
  }
  initHorizontal() {
    console.log("init");
    switch (this.styleHorizontal) {
      case "classic":
        this.initClassicMode(this.animateHorizontal);
        break;
      case "slider_click":
        this.initHorizontalSliderClick();
    }
  }
  setActiveUpTo(t) {
    this.items.forEach((e, i) => {
      if (i <= t) {
        e.classList.add("is-active");
      } else {
        e.classList.remove("is-active");
      }
    });
    this.activeIndex = t;
  }
  setOnlyOpen(t) {
    this.items.forEach((e, i) => {
      e.classList.toggle("is-open", i === t);
    });
  }
  updateActiveContentFrom(t) {
    if (!this.activeContentOutlet) {
      return;
    }
    let e = this.activeContentOutlet;
    let i = this.items[t];
    if (!i) {
      return;
    }
    let s = i.querySelector(".timeline-item__active");
    if (!s) {
      return;
    }
    let n = s.innerHTML;
    let r = e.querySelector(".timeline-active-content__inner");
    if (!r) {
      (r = document.createElement("div")).className = "timeline-active-content__inner";
      r.innerHTML = e.innerHTML;
      e.innerHTML = "";
      e.appendChild(r);
    }
    let o = e.offsetHeight;
    e.style.height = `${o}px`;
    let a = e.style.transition;
    e.style.transition = "none";
    e.style.opacity = "0";
    e.offsetHeight;
    r.innerHTML = n;
    e.style.height = "auto";
    let l = e.offsetHeight;
    e.style.height = `${o}px`;
    e.offsetHeight;
    e.style.transition = a || "";
    requestAnimationFrame(() => {
      e.style.height = `${l}px`;
      e.style.opacity = "1";
    });
    let d = t => {
      if (t.propertyName === "height") {
        e.style.height = "";
        e.removeEventListener("transitionend", d);
      }
    };
    e.addEventListener("transitionend", d);
  }
  whenSectionEntersViewport(t) {
    let e = new IntersectionObserver(i => {
      for (let s of i) {
        if (s.isIntersecting) {
          e.disconnect();
          t();
          break;
        }
      }
    }, {
      root: null,
      threshold: 0.15
    });
    e.observe(this);
  }
  computeIndexClosestToViewportCenter() {
    let t = window.innerHeight / 2;
    let e = 0;
    let i = Infinity;
    for (let s = 0; s < this.items.length; s++) {
      let n = this.items[s].getBoundingClientRect();
      let r = n.top + n.height / 2;
      let o = Math.abs(r - t);
      if (o < i) {
        i = o;
        e = s;
      }
    }
    return e;
  }
  attachScrollListener(t) {
    let e = false;
    let i = () => {
      if (!e) {
        e = true;
        requestAnimationFrame(() => {
          t();
          e = false;
        });
      }
    };
    window.addEventListener("scroll", i, {
      passive: true
    });
    return () => window.removeEventListener("scroll", i);
  }
  computeCompressionFactor(t, e) {
    let i = Math.abs(Number(t) - Number(e));
    return Math.max(1, i);
  }
  withCompressedDurationsToFinishTogether(t, e, i) {
    let s = this.computeCompressionFactor(t, e);
    if (this._restoreTimer) {
      clearTimeout(this._restoreTimer);
      this._restoreTimer = null;
    }
    if (!this.timelineRoot || s <= 1) {
      i?.();
      return 0;
    }
    let n = this.pointAnimMs / s / 1000;
    let r = this.lineAnimMs / s / 1000;
    let o = this.timelineRoot.style.getPropertyValue("--point-animation-duration");
    let a = this.timelineRoot.style.getPropertyValue("--line-animation-duration");
    this.timelineRoot.style.setProperty("--point-animation-duration", `${n}s`);
    this.timelineRoot.style.setProperty("--line-animation-duration", `${r}s`);
    i?.();
    let l = this.pointAnimMs + this.lineAnimMs;
    this._restoreTimer = window.setTimeout(() => {
      if (o) {
        this.timelineRoot.style.setProperty("--point-animation-duration", o.trim());
      } else {
        this.timelineRoot.style.removeProperty("--point-animation-duration");
      }
      if (a) {
        this.timelineRoot.style.setProperty("--line-animation-duration", a.trim());
      } else {
        this.timelineRoot.style.removeProperty("--line-animation-duration");
      }
      this._restoreTimer = null;
    }, l);
    return l;
  }
  smoothScrollItemToViewportCenter(t) {
    let e = this.items[t];
    if (!e) {
      return 0;
    }
    let i = e.getBoundingClientRect();
    let s = i.top + i.height / 2;
    let n = window.innerHeight / 2;
    let r = s - n;
    if (Math.abs(r) < 2) {
      return 0;
    }
    let o = window.scrollY + r;
    window.scrollTo({
      top: o,
      behavior: "smooth"
    });
    return Math.min(900, Math.max(200, Math.abs(r) / 1.2));
  }
  activateItem(t, e = {}) {
    let {
      scrollIntoView: i = false
    } = e;
    if (i) {
      this._suppressScroll = true;
    }
    let s = this.activeIndex ?? 0;
    let n = this.withCompressedDurationsToFinishTogether(t, s, () => {
      this.setOnlyOpen(t);
      this.setActiveUpTo(t);
      this.updateActiveContentFrom(t);
    });
    let r = 0;
    if (i) {
      r = this.smoothScrollItemToViewportCenter(t);
    }
    if (i) {
      let o = Math.max(n, r) + 50;
      window.setTimeout(() => {
        this._suppressScroll = false;
      }, o);
    }
  }
  attachItemClickActivation(t) {
    this.items.forEach((e, i) => {
      e.addEventListener("click", e => {
        console.log("a");
        if (!e.target.closest("a, input, select, textarea, [data-stop-activation]")) {
          this.activateItem(i, {
            scrollIntoView: t
          });
          if (this.sliderComponent) {
            this.sliderComponent.setCurrentIndexFromTimeline(i);
          }
        }
      });
    });
  }
  initClassicMode(t) {
    if (t) {
      this.whenSectionEntersViewport(() => {
        this.items.forEach((t, e) => {
          setTimeout(() => t.classList.add("is-active"), this.stepDelayMs * e);
        });
      });
    }
  }
  initVerticalScrollActivated() {
    this.whenSectionEntersViewport(() => {
      this.setActiveUpTo(0);
      this.setOnlyOpen(0);
      this.updateActiveContentFrom(0);
      let t = () => {
        if (this._suppressScroll) {
          return;
        }
        let t = this.computeIndexClosestToViewportCenter();
        if (t !== this.activeIndex) {
          this.setActiveUpTo(t);
          this.setOnlyOpen(t);
          this.updateActiveContentFrom(t);
        }
      };
      t();
      this.detachScroll = this.attachScrollListener(t);
      this.attachItemClickActivation(true);
    });
  }
  initVerticalAccordion() {
    this.setActiveUpTo(0);
    this.setOnlyOpen(0);
    this.updateActiveContentFrom(0);
    this.items.forEach((t, e) => {
      let i = t.querySelector(".timeline-item__header");
      if (i) {
        i.addEventListener("click", () => {
          if (i.getAttribute("aria-disabled") !== "true") {
            this.activateItem(e, {
              scrollIntoView: false
            });
          }
        });
      }
    });
  }
  initHorizontalSliderClick() {
    this.setActiveUpTo(0);
    this.setOnlyOpen(0);
    this.updateActiveContentFrom(0);
    this.attachItemClickActivation(false);
    if (this.sliderComponent) {
      this.sliderComponent.addEventListener("slideChanged", t => {
        let e = t.detail || {};
        let i = Number(e.currentPage);
        if (!i || Number.isNaN(i)) {
          return;
        }
        let s = i - 1;
        if (!(s < 0) && !(s >= this.items.length)) {
          this.activateItem(s, {
            scrollIntoView: false
          });
        }
      });
    }
  }
  onHorizontalSliderIndexChange(t) {
    this.activateItem(t, {
      scrollIntoView: false
    });
  }
  alignMarkersToHeaders() {
    if (this.items?.length) {
      for (let t = 0; t < this.items.length; t++) {
        let e = this.items[t].querySelector(".timeline__point");
        let i = this.items[t].querySelector(".timeline__line");
        if (e) {
          e.style.marginTop = "";
        }
        if (i) {
          i.style.marginBottom = "";
        }
      }
      for (let s = this.items.length - 1; s >= 0; s--) {
        let n = this.items[s];
        let r = n.querySelector(".timeline-item__header");
        let o = n.querySelector(".timeline__point");
        if (!r || !o) {
          continue;
        }
        let a = r.offsetHeight || 0;
        let l = o.offsetHeight || 0;
        let d = Math.max(0, Math.round((a - l) / 2));
        if (d > 0) {
          o.style.marginTop = `${d}px`;
        }
        if (s - 1 >= 0) {
          let c = this.items[s - 1].querySelector(".timeline__line");
          if (c) {
            if (d > 0) {
              c.style.marginBottom = `calc((var(--items-spacing-vertical) - var(--line-point-spacing)) * -1 - ${d}px)`;
            } else {
              c.style.marginBottom = "";
            }
          }
        }
      }
    }
  }
  centerHorizontalItem(t) {
    if (!this.itemsContainer) {
      return;
    }
    let e = this.items[t];
    if (!e) {
      return;
    }
    let i = this.itemsContainer;
    let s = i.getBoundingClientRect();
    let n = e.getBoundingClientRect();
    let r = s.width;
    let o = i.scrollWidth - r;
    let a = n.left - s.left + i.scrollLeft + n.width / 2;
    let l = a - r / 2;
    l = Math.max(0, Math.min(l, o));
    i.scrollTo({
      left: l,
      behavior: "smooth"
    });
  }
  disconnectedCallback() {
    if (typeof this.detachScroll == "function") {
      this.detachScroll();
    }
    if (this._restoreTimer) {
      clearTimeout(this._restoreTimer);
      this._restoreTimer = null;
    }
  }
}
customElements.define("dbtfyprime-timeline", DbtfyPrimeTimeline);
class TimelineSlider extends SliderComponent {
  constructor() {
    super();
    this.timelineOwner = this.closest("dbtfyprime-timeline") || null;
    this.currentIndex = 0;
  }
  get maxIndex() {
    return Math.max(0, this.sliderItemsToShow.length - 1);
  }
  clampIndex(t) {
    return Math.max(0, Math.min(t, this.maxIndex));
  }
  get isTimelineClickMode() {
    let t = this.timelineOwner;
    if (!t) {
      return false;
    }
    let e = t.styleHorizontal;
    let i = t.dataset.styleHorizontal;
    return (e || i) === "slider_click";
  }
  scrollToCenterIndex(t) {
    if (!this.slider || !this.sliderItemOffset) {
      return;
    }
    let e = this.slidesPerPage || 1;
    let i = t - Math.floor(e / 2);
    let s = Math.max(0, this.sliderItemsToShow.length - e);
    if (i < 0) {
      i = 0;
    }
    if (i > s) {
      i = s;
    }
    let n = i * this.sliderItemOffset;
    this.slider.scrollTo({
      left: n * this.scrollMultiplier,
      behavior: "smooth"
    });
  }
  updateHorizontalArrows() {
    if (this.prevButton && this.nextButton) {
      if (this.currentIndex <= 0) {
        this.prevButton.setAttribute("disabled", "disabled");
      } else {
        this.prevButton.removeAttribute("disabled");
      }
      if (this.currentIndex >= this.maxIndex) {
        this.nextButton.setAttribute("disabled", "disabled");
      } else {
        this.nextButton.removeAttribute("disabled");
      }
    }
  }
  goToIndex(t) {
    if (!this.isTimelineClickMode) {
      return;
    }
    let e = this.clampIndex(t);
    if (e !== this.currentIndex) {
      this.currentIndex = e;
      this.scrollToCenterIndex(this.currentIndex);
      this.updateHorizontalArrows();
      if (this.timelineOwner && typeof this.timelineOwner.onHorizontalSliderIndexChange == "function") {
        this.timelineOwner.onHorizontalSliderIndexChange(this.currentIndex);
      }
    }
  }
  onButtonClick(t) {
    if (!this.isTimelineClickMode) {
      return SliderComponent.prototype.onButtonClick.call(this, t);
    }
    t.preventDefault();
    let e = t.currentTarget.name === "next" ? 1 : -1;
    this.goToIndex(this.currentIndex + e);
  }
  setCurrentIndexFromTimeline(t) {
    if (this.isTimelineClickMode) {
      this.goToIndex(t);
    }
  }
  update() {
    if (!this.isTimelineClickMode) {
      return SliderComponent.prototype.update.call(this);
    }
    this.updateHorizontalArrows();
  }
}
customElements.define("timeline-slider", TimelineSlider);
class JsonAnimation extends HTMLElement {
  constructor() {
    super();
    this.animation = null;
    this.currentUrl = null;
    this.observer = null;
    this.resizeTimeout = null;
    this._initialized = false;
    this._onResize = this._onResize.bind(this);
    this._onClick = this._onClick.bind(this);
  }
  connectedCallback() {
    if (!this._initialized) {
      this._initialized = true;
      if (!window.lottie || !window.lottie.loadAnimation) {
        console.warn("<json-animation> requires lottie-web to be loaded.");
        return;
      }
      this.desktopUrl = this.getAttribute("animation-url") || this.dataset.animationUrl || "";
      this.mobileUrl = this.getAttribute("animation-url-mobile") || this.dataset.animationUrlMobile || "";
      if (!this.desktopUrl) {
        console.warn("<json-animation> missing animation-url");
        return;
      }
      this.loop = this._getBoolAttr("loop", true);
      this.autoplay = this._getBoolAttr("autoplay", true);
      this.clickToPlay = this._getBoolAttr("click-to-play", false);
      this.speed = parseFloat(this.getAttribute("speed") || this.dataset.speed) || 1;
      if (this.clickToPlay) {
        this.style.cursor = "pointer";
        this.addEventListener("click", this._onClick);
      }
      this._loadAnimation();
      window.addEventListener("resize", this._onResize);
    }
  }
  disconnectedCallback() {
    window.removeEventListener("resize", this._onResize);
    this.removeEventListener("click", this._onClick);
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.animation) {
      this.animation.destroy();
      this.animation = null;
    }
    clearTimeout(this.resizeTimeout);
  }
  _getBoolAttr(t, e) {
    if (!this.hasAttribute(t)) {
      return e;
    }
    let i = this.getAttribute(t);
    return i === "" || i === null || i === "true" || i === "1";
  }
  _isMobile() {
    return window.innerWidth < 750;
  }
  _getAnimationUrl() {
    if (this._isMobile() && this.mobileUrl) {
      return this.mobileUrl;
    } else {
      return this.desktopUrl;
    }
  }
  _onResize() {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => {
      this._loadAnimation();
    }, 250);
  }
  _onClick() {
    if (this.animation) {
      if (this.animation.isPaused) {
        this.animation.play();
      } else {
        this.animation.pause();
      }
    }
  }
  _setupObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (!this.autoplay) {
      this.observer = new IntersectionObserver(t => {
        t.forEach(t => {
          if (this.animation) {
            if (t.isIntersecting) {
              this.animation.play();
              if (!this.loop) {
                this.observer.unobserve(this);
              }
            } else if (this.loop) {
              this.animation.pause();
            }
          }
        });
      }, {
        threshold: 0.3
      });
      this.observer.observe(this);
    }
  }
  _loadAnimation() {
    let t = this._getAnimationUrl();
    if (t) {
      if (this.currentUrl !== t || !this.animation) {
        this.currentUrl = t;
        if (this.animation) {
          this.animation.destroy();
          this.animation = null;
        }
        this.innerHTML = "";
        this.animation = window.lottie.loadAnimation({
          container: this,
          renderer: "svg",
          loop: this.loop,
          autoplay: this.autoplay,
          path: t
        });
        this.animation.setSpeed(this.speed);
        this._setupObserver();
      }
    }
  }
}
customElements.define("json-animation", JsonAnimation);