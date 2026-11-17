import pandas as pd
import streamlit as st

st.set_page_config(page_title="ProjectPERT Estimator", layout="wide")

st.title("🏗️ ProjectPERT Estimator")
st.subheader("Detailed Cost Estimate + PERT Calculator")

CATEGORIES = ["Material", "Labor", "Equipment"]
COLUMNS = ["Item", "Quantity", "Unit Cost", "Category"]


def peso(value: float) -> str:
    return f"₱ {value:,.2f}"


tab1, tab2 = st.tabs(["Cost Estimate", "PERT"])

# -----------------------------
# COST ESTIMATE MODULE
# -----------------------------
with tab1:
    st.header("Detailed Cost Estimate")

    if "cost_items" not in st.session_state:
        st.session_state.cost_items = pd.DataFrame(columns=COLUMNS)

    with st.form("add_item", clear_on_submit=True):
        c1, c2, c3, c4 = st.columns(4)
        item = c1.text_input("Item")
        qty = c2.number_input("Quantity", min_value=0.0, value=1.0)
        unit_cost = c3.number_input("Unit Cost (₱)", min_value=0.0)
        category = c4.selectbox("Category", CATEGORIES)
        submitted = st.form_submit_button("Add Item")

    if submitted:
        if not item.strip():
            st.warning("Enter an item name before adding.")
        else:
            new_row = pd.DataFrame([[item.strip(), qty, unit_cost, category]], columns=COLUMNS)
            st.session_state.cost_items = pd.concat(
                [st.session_state.cost_items, new_row], ignore_index=True
            )

    if st.session_state.cost_items.empty:
        st.info("No items yet. Add one above.")
    else:
        st.caption("Edit cells directly, or select rows and press Delete to remove them.")
        edited = st.data_editor(
            st.session_state.cost_items,
            num_rows="dynamic",
            hide_index=True,
            column_config={
                "Quantity": st.column_config.NumberColumn(min_value=0.0),
                "Unit Cost": st.column_config.NumberColumn("Unit Cost (₱)", min_value=0.0, format="%.2f"),
                "Category": st.column_config.SelectboxColumn(options=CATEGORIES, required=True),
            },
            key="items_editor",
        )
        # Keep only usable rows; amounts are always recomputed from the edited values.
        df = edited.dropna(subset=["Item", "Category"]).copy()
        df["Quantity"] = pd.to_numeric(df["Quantity"], errors="coerce").fillna(0.0)
        df["Unit Cost"] = pd.to_numeric(df["Unit Cost"], errors="coerce").fillna(0.0)
        df["Amount"] = df["Quantity"] * df["Unit Cost"]
        st.session_state.cost_items = df[COLUMNS].reset_index(drop=True)

        if st.button("Clear all items"):
            st.session_state.cost_items = pd.DataFrame(columns=COLUMNS)
            st.rerun()

        by_cat = df.groupby("Category")["Amount"].sum()
        materials = by_cat.get("Material", 0.0)
        labor = by_cat.get("Labor", 0.0)
        equipment = by_cat.get("Equipment", 0.0)
        direct_cost = materials + labor + equipment

        p1, p2, p3 = st.columns(3)
        ohp_percent = p1.number_input("Overhead, Profit & Misc (%)", min_value=0.0, value=12.0)
        contingency_percent = p2.number_input("Contingency (%)", min_value=0.0, value=3.0)
        vat_percent = p3.number_input("VAT (%)", min_value=0.0, value=5.0)

        # OHP and contingency are based on direct cost; VAT is charged on the
        # subtotal (direct cost + markups), as it is on the final billed amount.
        ohp = direct_cost * ohp_percent / 100
        contingency = direct_cost * contingency_percent / 100
        subtotal = direct_cost + ohp + contingency
        vat = subtotal * vat_percent / 100
        grand_total = subtotal + vat

        st.markdown("---")
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Materials", peso(materials))
        m2.metric("Labor", peso(labor))
        m3.metric("Equipment", peso(equipment))
        m4.metric("Direct Cost", peso(direct_cost))

        b1, b2, b3, b4 = st.columns(4)
        b1.metric(f"OHP ({ohp_percent:g}%)", peso(ohp))
        b2.metric(f"Contingency ({contingency_percent:g}%)", peso(contingency))
        b3.metric(f"VAT ({vat_percent:g}%)", peso(vat))
        b4.metric("Grand Total", peso(grand_total))

        if direct_cost > 0:
            st.success(
                f"Materials: {materials / direct_cost * 100:.2f}% | "
                f"Labor: {labor / direct_cost * 100:.2f}% | "
                f"Equipment: {equipment / direct_cost * 100:.2f}%"
            )

# -----------------------------
# PERT MODULE
# -----------------------------
with tab2:
    st.header("PERT Calculator")

    optimistic = st.number_input("Optimistic Time (O)", min_value=0.0, value=2.0)
    likely = st.number_input("Most Likely Time (M)", min_value=0.0, value=4.0)
    pessimistic = st.number_input("Pessimistic Time (P)", min_value=0.0, value=8.0)

    if not (optimistic <= likely <= pessimistic):
        st.error("Estimates must satisfy O ≤ M ≤ P.")
    else:
        expected = (optimistic + 4 * likely + pessimistic) / 6
        std_dev = (pessimistic - optimistic) / 6
        variance = std_dev**2

        r1, r2, r3 = st.columns(3)
        r1.metric("Expected Duration", f"{expected:.2f} Days")
        r2.metric("Variance", f"{variance:.2f}")
        r3.metric("Std. Deviation", f"{std_dev:.2f} Days")

        st.info("Formulas: TE = (O + 4M + P) / 6 | σ = (P − O) / 6 | Variance = σ²")

st.markdown("---")
st.caption("ProjectPERT Estimator v1.1")
