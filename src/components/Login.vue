<template>
  <div>
    <!-- :isDisabled="!isAllValid" -->
    <InputModal
      :isFullPage="false"
      :isOpen="isModalOpen"
      :closeFunc="toggleModal"
      :confirmFunc="confirm"
      :isDisabled="isProcessing"
    >
      <template #title>
        {{ alreadySignUp ? "Log in" : "Sign up" }}
      </template>

      <template #inputs>
        <div class="space-y-8">
          <div class="text-red-400">{{ otherError }}</div>
          <div class="space-y-2">
            <label class="text-slate-600">Email</label>
            <InputEmail
              :modelValue="form.email"
              :firebaseError="formError.email"
              @input="form.email = $event.target.value"
              @setInputValidity="setInputValidity"
              ref="inputEmailRef"
            />
          </div>
          <div class="space-y-2">
            <label class="text-slate-600">Password</label>
            <InputPassword
              :modelValue="form.password"
              :firebaseError="formError.password"
              @input="form.password = $event.target.value"
              @setInputValidity="setInputValidity"
              ref="inputPasswordRef"
            />
          </div>
          <div class="space-y-2" v-if="!alreadySignUp">
            <label class="text-slate-600">Confirm Password</label>
            <div class="relative">
              <input
                name="passwordConfirm"
                type="password"
                class="border border-slate-300 block px-4 py-3 rounded w-full text-sm text-left focus:outline-0 invalid:border-red-400 invalid:border valid:focus:outline-indigo-300/60 valid:focus:outline-2"
                placeholder="Pleas confirm the password"
                v-model="form.passwordConfirm"
                ref="inputPasswordConfirmRef"
              />
              <ErrorDisplay :errors="[formError.passwordConfirm]" />
            </div>
          </div>

          <div class="text-slate-600 text-sm font-light">
            {{
              alreadySignUp
                ? "Don't have an account yet?"
                : "Already have an account?"
            }}

            <button
              class="underline text-indigo-600 focus:outline-none focus:font-normal rounded"
              @click="
                alreadySignUp
                  ? $emit('toggleSignUp', false)
                  : $emit('toggleSignUp', true)
              "
            >
              {{ alreadySignUp ? "Sign up" : "Log in" }}
            </button>
          </div>
        </div>
      </template>
      <template #okButton>
        <div>
          {{ alreadySignUp ? "Log in" : "Create account" }}
        </div>
      </template>
    </InputModal>
  </div>
</template>

<script>
import { ref, defineAsyncComponent, computed, watch, watchEffect } from "vue";
import InputEmail from "@/components/forms/InputEmail.vue";
import InputPassword from "@/components/forms/InputPassword.vue";
import http from "@/api";
import { useClickPrevention } from "@/composables/useClickPrevention.js";
import { useRouter } from "vue-router";
import {
  getAuth,
  setPersistence,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "../firebase";

export default {
  components: {
    InputEmail,
    InputPassword,
    InputModal: defineAsyncComponent(() =>
      import("@/components/InputModal.vue")
    ),
    ErrorDisplay: defineAsyncComponent(() =>
      import("@/components/ErrorDisplay.vue")
    ),
  },
  props: {
    isModalOpen: Boolean,
    alreadySignUp: Boolean,
    toggleModal: Function,
  },
  emits: ["toggleModal", "checkLogin", "toggleSignUp", "setSnackbarMessage"],
  setup(props, { emit }) {
    const { isClickDisabled, preventMultipleClicks } = useClickPrevention(1000);
    const router = useRouter();

    // validity
    const inputValidity = ref({
      email: null,
      password: null,
      passwordConfirm: null,
    });

    function setInputValidity(validityObj) {
      const { name, validity } = validityObj;
      inputValidity.value[name] = validity;
    }

    watchEffect(() => {
      // 切換註冊/登入時重設 inputValidity
      setInputValidity({
        name: "passwordConfirm",
        validity: props.alreadySignUp,
      });
    });

    // loading
    const isAllValid = computed(() => {
      return Object.values(inputValidity.value).every((item) => !!item);
    });
    const isLoading = ref(false);
    const isProcessing = computed(() => {
      return !isAllValid.value || isLoading.value;
    });

    function toggleLoading(val) {
      isLoading.value = val;
    }

    // sign up / log in
    const form = ref({
      email: "",
      password: "",
      passwordConfirm: "",
    });
    const formError = ref({
      email: "",
      password: "",
      passwordConfirm: "",
    });
    const otherError = ref("");

    async function logIn(auth, email, password) {
      try {
        const userCredential = await signInWithEmailAndPassword(
          auth,
          email,
          password
        );

        // const user = userCredential.user;

        // Exchange ID token for session cookie
        const idToken = await userCredential.user.getIdToken();
        const res = await http.post("/sessionLogin", {
          idToken,
        });

        const { success, content, errorMessage, result } = res.data;

        if (success) {
          signOut(auth);
          setCookie("__session", result.cookie, 3600);
          resetForm();
        }

        emit("toggleModal", { open: !success });
        emit("checkLogin", result.hasLogin);
        emit("setSnackbarMessage", {
          success,
          content: success ? "login success" : `${content} / ${errorMessage}`,
        });
      } catch (error) {
        const errorCode = error.code;
        const isEmailError = errorCode?.includes("email");
        const isUserError = errorCode?.includes("user");
        const isPasswordError = errorCode?.toLowerCase().includes("password");

        if (isEmailError || (isUserError && !isPasswordError)) {
          formError.value.email = errorCode.substring(5);
        } else if (isPasswordError) {
          formError.value.password = errorCode.substring(5);
        } else {
          otherError.value = error.message;
        }
      }
    }

    async function signUp(auth, email, password) {
      await createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
          resetForm();
          emit("toggleModal", { open: false });
          emit("checkLogin", false);
          emit("setSnackbarMessage", {
            success: true,
            content: "signup success",
          });
        })
        .catch((error) => {
          const errorCode = error.codes;
          const isEmailError = errorCode?.includes("email");
          const isUserError = errorCode?.includes("user");
          const isPasswordError = errorCode?.toLowerCase().includes("password");

          if (isEmailError || (isUserError && !isPasswordError)) {
            formError.value.email = errorCode.substring(5);
          } else if (isPasswordError) {
            formError.value.password = errorCode.substring(5);
          }
        });
    }

    async function confirm() {
      if (!isAllValid.value || isClickDisabled.value) return;
      preventMultipleClicks();
      toggleLoading(true);

      const email = form.value.email;
      const password = form.value.password;

      if (!email) {
        formError.value.email = "please provide email";
        return;
      }

      if (!password) {
        formError.value.password = "please provide password";
        return;
      }

      const auth = getAuth();
      await setPersistence(auth, inMemoryPersistence);

      if (props.alreadySignUp) {
        await logIn(auth, email, password);
      } else {
        await signUp(auth, email, password);
      }

      toggleLoading(false);
    }

    function setCookie(cname, cvalue, maxAge) {
      document.cookie = `${cname}=${cvalue};max-age=${maxAge}`;
    }

    const inputEmailRef = ref(null);
    const inputPasswordRef = ref(null);
    const inputPasswordConfirmRef = ref(null);

    function resetForm() {
      inputEmailRef.value.inputValue = null;
      inputPasswordRef.value.inputValue = null;
      form.value.passwordConfirm = "";
    }

    function confirmPassword(passwordConfirmed) {
      const isPwdConfirmed = form.value.password === passwordConfirmed;
      const msg = isPwdConfirmed ? "" : "Password are not matching";

      formError.value.passwordConfirm = msg;
      inputPasswordConfirmRef.value.setCustomValidity(msg);
      setInputValidity({ name: "passwordConfirm", validity: isPwdConfirmed });
    }

    watch(
      () => form.value.passwordConfirm,
      (newVal) => {
        if (props.alreadySignUp) return;
        confirmPassword(newVal);
      }
    );

    watch(
      () => props.alreadySignUp,
      () => resetForm()
    );

    return {
      inputEmailRef,
      inputPasswordRef,
      inputPasswordConfirmRef,
      isAllValid,
      isProcessing,
      form,
      formError,
      otherError,
      confirm,
      setInputValidity,
    };
  },
};
</script>