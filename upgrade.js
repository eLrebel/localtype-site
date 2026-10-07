"use strict";

const config = globalThis.LOCALTYPE_PAYMENTS || {
  enabled: false
};

const params = new URLSearchParams(location.search);
const installationId = String(
  params.get("installation") || ""
).trim();

const els = {
  priceLabel: document.querySelector("#priceLabel"),
  buyButton: document.querySelector("#buyButton"),
  checkoutStatus: document.querySelector("#checkoutStatus"),
  restoreForm: document.querySelector("#restoreForm"),
  purchaseEmail: document.querySelector("#purchaseEmail"),
  transactionId: document.querySelector("#transactionId"),
  restoreButton: document.querySelector("#restoreButton"),
  activationResult: document.querySelector("#activationResult"),
  activationToken: document.querySelector("#activationToken"),
  activationMessage: document.querySelector("#activationMessage"),
  copyTokenButton: document.querySelector("#copyTokenButton"),
  deactivateButton: document.querySelector("#deactivateButton")
};

let lastActivation = null;

function setMessage(message, tone = "") {
  els.activationMessage.textContent = message;
  els.activationMessage.dataset.tone = tone;
}

function setBusy(busy) {
  els.buyButton.disabled = busy || !config.enabled;
  els.restoreButton.disabled = busy || !config.enabled;
}

function apiUrl(path) {
  return String(config.licenseApiBase || "")
    .replace(/\/$/, "") + path;
}

function validateRuntimeConfig() {
  const missing = [];

  if (!installationId) missing.push("installation id");
  if (!config.clientToken) missing.push("Paddle client token");
  if (!config.priceId) missing.push("Paddle price id");
  if (!config.licenseApiBase) missing.push("license service");

  return missing;
}

async function callLicenseApi(path, payload) {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({
    ok: false,
    reason: "invalid_response"
  }));

  if (!response.ok || !data?.ok) {
    const error = new Error(
      String(data?.reason || "activation_failed")
    );
    error.code = String(data?.reason || "activation_failed");
    error.data = data;
    throw error;
  }

  return data;
}

function explainActivationError(error) {
  const code = String(error?.code || error?.message || "");

  const messages = {
    payment_pending:
      "Your payment is still processing. Wait for Paddle to complete it, then use Restore again.",
    email_mismatch:
      "That email does not match the Paddle purchase.",
    wrong_product:
      "That transaction is not a LocalType Pro purchase.",
    purchase_refunded_or_disputed:
      "This purchase was refunded or disputed and cannot activate Pro.",
    purchase_revoked:
      "This purchase is no longer eligible for activation.",
    device_limit_reached:
      "This lifetime license is already active on the maximum number of devices. Deactivate one device before adding another.",
    transaction_not_found:
      "Paddle could not find that transaction ID.",
    invalid_request:
      "Check the purchase email and transaction ID and try again.",
    service_error:
      "The LocalType licensing service is temporarily unavailable."
  };

  return messages[code] ||
    "LocalType could not activate this purchase. Check the details and try again.";
}

async function activatePurchase(transactionId, email) {
  if (!config.enabled) {
    throw Object.assign(
      new Error("payments_not_live"),
      { code: "payments_not_live" }
    );
  }

  if (!installationId) {
    throw Object.assign(
      new Error("missing_installation"),
      { code: "missing_installation" }
    );
  }

  return callLicenseApi("/v1/activate", {
    transactionId,
    email,
    installationId
  });
}

function showActivation(data, transactionId, email) {
  lastActivation = {
    transactionId,
    email,
    installationId
  };

  els.activationToken.value = String(data.token || "");
  els.activationResult.classList.remove("hidden");

  setMessage(
    "Pro activation created for this LocalType installation. " +
      String(data.activeDevices || 1) +
      " of " +
      String(data.maxDevices || config.maxDevices || 3) +
      " device slots are now in use.",
    "success"
  );

  els.activationResult.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

async function handleCheckoutEvent(event) {
  if (event?.name !== "checkout.completed") return;

  const transactionId = String(
    event?.data?.transaction_id || ""
  );
  const email = String(
    event?.data?.customer?.email || ""
  );

  if (!transactionId || !email) {
    setMessage(
      "Payment completed. Use the Restore form with the transaction ID from your Paddle receipt.",
      "success"
    );
    return;
  }

  els.transactionId.value = transactionId;
  els.purchaseEmail.value = email;

  setBusy(true);
  setMessage("Payment completed. Creating your Pro activation…");

  try {
    const result = await activatePurchase(
      transactionId,
      email
    );

    showActivation(result, transactionId, email);
  } catch (error) {
    setMessage(explainActivationError(error), "error");
  } finally {
    setBusy(false);
  }
}

function initializeCheckout() {
  els.priceLabel.textContent =
    config.priceLabel || "$24.99 lifetime";

  const missing = validateRuntimeConfig();

  if (!config.enabled || missing.length) {
    els.buyButton.disabled = true;
    els.restoreButton.disabled = true;
    els.checkoutStatus.textContent =
      installationId ? "Checkout is currently unavailable." : "Open this page from LocalType → Manage → Plan to link your device.";
    setMessage(
      "Purchases are not live yet. LocalType's commercial system is staged but intentionally disabled.",
      "muted"
    );
    return;
  }

  if (!globalThis.Paddle) {
    els.buyButton.disabled = true;
    els.restoreButton.disabled = true;
    els.checkoutStatus.textContent =
      "Paddle checkout could not load. Please refresh.";
    return;
  }

  if (config.environment === "sandbox") {
    Paddle.Environment.set("sandbox");
  }

  Paddle.Initialize({
    token: config.clientToken,
    eventCallback: (event) => {
      void handleCheckoutEvent(event);
    }
  });

  els.checkoutStatus.textContent =
    config.environment === "sandbox" ? "Sandbox checkout: use test payment details only." : "Secure checkout is provided by Paddle.";
  setMessage(
    "Already purchased? Restore Pro below using your Paddle receipt.",
    "muted"
  );
}

els.buyButton.addEventListener("click", () => {
  if (!config.enabled) return;

  Paddle.Checkout.open({
    items: [
      {
        priceId: config.priceId,
        quantity: 1
      }
    ],
    customData: {
      localtype_installation_id: installationId,
      localtype_product: "localtype",
      localtype_license: "lifetime"
    },
    settings: {
      displayMode: "overlay",
      theme: "light",
      locale: "en"
    }
  });
});

els.restoreForm.addEventListener("submit", (event) => {
  event.preventDefault();

  void (async () => {
    const transactionId = els.transactionId.value.trim();
    const email = els.purchaseEmail.value.trim();

    setBusy(true);
    setMessage("Verifying your Paddle purchase…");

    try {
      const result = await activatePurchase(
        transactionId,
        email
      );

      showActivation(result, transactionId, email);
    } catch (error) {
      setMessage(explainActivationError(error), "error");
    } finally {
      setBusy(false);
    }
  })();
});

els.copyTokenButton.addEventListener("click", () => {
  void navigator.clipboard
    .writeText(els.activationToken.value)
    .then(() => {
      setMessage(
        "Activation token copied. Paste it into LocalType → Manage → Plan.",
        "success"
      );
    })
    .catch(() => {
      els.activationToken.select();
      setMessage(
        "Select and copy the activation token manually.",
        "muted"
      );
    });
});

els.deactivateButton.addEventListener("click", () => {
  if (!lastActivation) return;

  void (async () => {
    setBusy(true);
    setMessage("Deactivating this device…");

    try {
      const result = await callLicenseApi(
        "/v1/deactivate",
        lastActivation
      );

      lastActivation = null;
      els.activationResult.classList.add("hidden");
      els.activationToken.value = "";

      setMessage(
        "This LocalType installation was deactivated. " +
          String(result.activeDevices || 0) +
          " device slots remain in use.",
        "success"
      );
    } catch (error) {
      setMessage(explainActivationError(error), "error");
    } finally {
      setBusy(false);
    }
  })();
});

initializeCheckout();
