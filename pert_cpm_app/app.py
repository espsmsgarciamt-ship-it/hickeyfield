import math

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import networkx as nx
import pandas as pd
import streamlit as st

st.set_page_config(page_title="ProjectPERT Estimator", layout="wide")

st.title("🏗️ ProjectPERT Estimator")
st.subheader("Cost Estimate + PERT + CPM + S-Curve")

CATEGORIES = ["Material", "Labor", "Equipment"]
COLUMNS = ["Item", "Quantity", "Unit Cost", "Category"]
COST_PARTS = ["MaterialCost", "LaborCost", "EquipmentCost"]
CPM_COLUMNS = ["Activity", "Duration", "Predecessors"] + COST_PARTS


def peso(value: float) -> str:
    return f"₱ {value:,.2f}"


def parse_preds(text) -> list[str]:
    if not isinstance(text, str) or text.strip() == "-":
        return []
    return [p.strip() for p in text.split(",") if p.strip()]


def compute_cpm(rows: pd.DataFrame):
    """Return (results DataFrame, project duration, critical path) or raise ValueError."""
    acts = {}
    for _, r in rows.iterrows():
        name = str(r["Activity"]).strip()
        if name in acts:
            raise ValueError(f"Duplicate activity ID: {name}")
        acts[name] = {"duration": float(r["Duration"]), "preds": parse_preds(r["Predecessors"]),
                      "cost": float(sum(r[c] for c in COST_PARTS))}

    for name, a in acts.items():
        for p in a["preds"]:
            if p not in acts:
                raise ValueError(f"Activity {name} has unknown predecessor: {p}")
            if p == name:
                raise ValueError(f"Activity {name} cannot be its own predecessor.")

    # Topological order (independent of the order activities were entered).
    order, done = [], set()
    while len(order) < len(acts):
        ready = [n for n in acts if n not in done and all(p in done for p in acts[n]["preds"])]
        if not ready:
            left = ", ".join(n for n in acts if n not in done)
            raise ValueError(f"Circular dependency among: {left}")
        for n in ready:
            order.append(n)
            done.add(n)

    for n in order:  # forward pass
        a = acts[n]
        a["ES"] = max((acts[p]["EF"] for p in a["preds"]), default=0)
        a["EF"] = a["ES"] + a["duration"]
    duration = max(a["EF"] for a in acts.values())

    for n in reversed(order):  # backward pass
        a = acts[n]
        succ = [acts[s]["LS"] for s in acts if n in acts[s]["preds"]]
        a["LF"] = min(succ, default=duration)
        a["LS"] = a["LF"] - a["duration"]
        a["Float"] = a["LS"] - a["ES"]

    result = pd.DataFrame(
        [[n, a["duration"], a["cost"], a["ES"], a["EF"], a["LS"], a["LF"], a["Float"]] for n, a in ((n, acts[n]) for n in order)],
        columns=["Activity", "Duration", "Cost", "ES", "EF", "LS", "LF", "Float"],
    )
    critical = [n for n in order if abs(acts[n]["Float"]) < 1e-9]
    return result, duration, critical




def draw_network(result: pd.DataFrame, preds: dict):
    """Layered left-to-right network: column = longest chain of predecessors."""
    info = result.set_index("Activity")
    G = nx.DiGraph()
    G.add_nodes_from(info.index)
    for act, ps in preds.items():
        G.add_edges_from((p, act) for p in ps)

    level = {}
    for n in info.index:  # `result` is already in dependency order
        level[n] = 1 + max((level[p] for p in preds[n]), default=-1)
    rows = {}
    for n, lv in level.items():
        rows.setdefault(lv, []).append(n)
    pos = {}
    for lv, names in rows.items():
        for i, n in enumerate(names):
            pos[n] = (lv, (len(names) - 1) / 2 - i)

    critical = info["Float"].abs() < 1e-9
    fig, ax = plt.subplots(figsize=(max(8, 2.6 * (max(level.values()) + 1)), max(4, 2.2 * max(map(len, rows.values())))))
    nx.draw_networkx_nodes(G, pos, node_color=["red" if critical[n] else "skyblue" for n in G.nodes()],
                           node_size=5200, ax=ax)
    nx.draw_networkx_edges(G, pos, arrows=True, arrowsize=20, node_size=5200, edge_color="black", ax=ax,
                           edgelist=[e for e in G.edges() if not (critical[e[0]] and critical[e[1]])])
    nx.draw_networkx_edges(G, pos, arrows=True, arrowsize=20, node_size=5200, edge_color="red", width=2.5, ax=ax,
                           edgelist=[e for e in G.edges() if critical[e[0]] and critical[e[1]]])
    labels = {n: f"{n}\nD={info.at[n, 'Duration']:g}\nES={info.at[n, 'ES']:g}  EF={info.at[n, 'EF']:g}\n"
                 f"LS={info.at[n, 'LS']:g}  LF={info.at[n, 'LF']:g}" for n in G.nodes()}
    nx.draw_networkx_labels(G, pos, labels, font_size=8, font_weight="bold", ax=ax)
    ax.set_xlim(-0.6, max(level.values()) + 0.6)
    ax.margins(y=0.2)
    ax.axis("off")
    return fig


def s_curve(result: pd.DataFrame, total_cost: float) -> pd.DataFrame:
    """Cumulative cost per day for the early-start and late-start schedules.

    Each activity's cost is spread evenly over its duration. Activities with no
    cost entered share `total_cost` in proportion to their duration (if every
    activity is blank), so the curve still has a shape.
    """
    costs = result["Cost"].astype(float)
    if costs.sum() <= 0:
        weight = result["Duration"].astype(float)
        costs = weight / weight.sum() * total_cost if weight.sum() > 0 else weight
    days = range(0, math.ceil(result["EF"].max()) + 1)
    out = {"Day": list(days)}
    for label, start in (("Early start", "ES"), ("Late start", "LS")):
        cum = []
        for t in days:
            total = 0.0
            for c, s, d in zip(costs, result[start], result["Duration"]):
                frac = 1.0 if d == 0 and t >= s else (0.0 if d == 0 else min(max((t - s) / d, 0.0), 1.0))
                total += c * frac
            cum.append(total)
        out[label] = cum
    return pd.DataFrame(out).set_index("Day")


tab_cost, tab_pert, tab_cpm, tab_s = st.tabs(["Cost Estimate", "PERT", "CPM", "S-Curve"])

# -----------------------------
# COST ESTIMATE MODULE
# -----------------------------
with tab_cost:
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

    st.session_state.grand_total = 0.0
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
        st.session_state.grand_total = float(grand_total)

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
with tab_pert:
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

# -----------------------------
# CPM MODULE
# -----------------------------
cpm_result = None
with tab_cpm:
    st.header("Critical Path Method (CPM)")
    st.markdown(
        "Enter activities with a duration (days), comma-separated predecessors "
        "(blank or `-` for none) and optional material, labor and equipment costs used by the S-Curve."
    )
    if "activities" not in st.session_state:
        st.session_state.activities = pd.DataFrame(columns=CPM_COLUMNS)

    with st.form("add_activity", clear_on_submit=True):
        c1, c2, c3, c4, c5, c6 = st.columns(6)
        activity = c1.text_input("Activity ID")
        duration = c2.number_input("Duration (Days)", min_value=0.0, value=1.0)
        predecessors = c3.text_input("Predecessors", placeholder="A,B")
        mat_cost = c4.number_input("Material Cost (₱)", min_value=0.0)
        lab_cost = c5.number_input("Labor Cost (₱)", min_value=0.0)
        eq_cost = c6.number_input("Equipment Cost (₱)", min_value=0.0)
        submitted = st.form_submit_button("Add Activity")

    if submitted:
        name = activity.strip()
        if not name:
            st.warning("Enter an Activity ID.")
        elif name in set(st.session_state.activities["Activity"]):
            st.warning(f"Activity {name} already exists.")
        else:
            st.session_state.activities = pd.concat(
                [st.session_state.activities, pd.DataFrame([[name, duration, predecessors.strip(), mat_cost, lab_cost, eq_cost]], columns=CPM_COLUMNS)],
                ignore_index=True,
            )

    if st.session_state.activities.empty:
        st.info("No activities yet. Add one above.")
    else:
        st.subheader("Activities")
        st.caption("Edit cells directly, or select rows and press Delete to remove them.")
        edited = st.data_editor(
            st.session_state.activities,
            num_rows="dynamic",
            hide_index=True,
            column_config={
                "Duration": st.column_config.NumberColumn(min_value=0.0),
                **{c: st.column_config.NumberColumn(c.replace("Cost", " Cost (₱)"), min_value=0.0, format="%.2f")
                   for c in COST_PARTS},
            },
            key="activities_editor",
        )
        df = edited.dropna(subset=["Activity"]).copy()
        df = df[df["Activity"].astype(str).str.strip() != ""]
        df["Duration"] = pd.to_numeric(df["Duration"], errors="coerce").fillna(0.0)
        df["Predecessors"] = df["Predecessors"].fillna("")
        for c in COST_PARTS:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
        st.session_state.activities = df[CPM_COLUMNS].reset_index(drop=True)

        if st.button("Clear all activities"):
            st.session_state.activities = pd.DataFrame(columns=CPM_COLUMNS)
            st.rerun()

        try:
            result_df, project_duration, critical_path = compute_cpm(df)
        except ValueError as e:
            st.error(str(e))
        else:
            cpm_result = result_df
            st.subheader("CPM Results")
            shown = result_df.assign(Critical=result_df["Float"].abs().lt(1e-9).map({True: "★", False: ""}))
            st.dataframe(shown, hide_index=True, width="stretch")
            st.metric("Project Duration", f"{project_duration:g} Days")
            st.error(f"Critical Path: {' → '.join(critical_path)}")

            st.subheader("📊 CPM Network Diagram")
            fig = draw_network(result_df, {n: parse_preds(p) for n, p in zip(df["Activity"].astype(str).str.strip(), df["Predecessors"])})
            st.pyplot(fig)
            plt.close(fig)
            st.caption("Red = critical activities (zero float). Arrows run left to right in order of dependency.")

# -----------------------------
# S-CURVE MODULE
# -----------------------------
with tab_s:
    st.header("S-Curve")
    if cpm_result is None:
        st.info("Add valid activities in the CPM tab first. The S-Curve is built from the CPM schedule.")
    else:
        total_cost = st.session_state.get("grand_total", 0.0)
        entered = cpm_result["Cost"].sum()
        if entered > 0:
            budget = entered
            st.caption(f"Using the activity costs from the CPM tab (total {peso(entered)}).")
        else:
            budget = total_cost
            st.caption(
                "No activity costs entered, so the Cost Estimate grand total "
                f"({peso(total_cost)}) is spread across activities by duration."
            )
        view = st.radio("Show", ["Cumulative %", "Cumulative cost (₱)"], horizontal=True)
        curve = s_curve(cpm_result, total_cost)
        if budget <= 0 and view == "Cumulative %":
            st.warning("No costs available. Enter activity costs or build a Cost Estimate.")
        else:
            data = curve / curve.iloc[-1].max() * 100 if view == "Cumulative %" else curve
            st.markdown("**Actual cost to date** (cumulative ₱ at the end of each project day)")
            if "actual_cost" not in st.session_state:
                st.session_state.actual_cost = pd.DataFrame({"Day": pd.Series(dtype=int), "Actual Cumulative Cost": pd.Series(dtype=float)})
            actual_df = st.data_editor(
                st.session_state.actual_cost, num_rows="dynamic", hide_index=True, key="actual_editor",
                column_config={
                    "Day": st.column_config.NumberColumn(min_value=0, step=1),
                    "Actual Cumulative Cost": st.column_config.NumberColumn("Actual Cumulative Cost (₱)", min_value=0.0, format="%.2f"),
                },
            )
            actual = actual_df.dropna().sort_values("Day")
            st.session_state.actual_cost = actual.reset_index(drop=True)
            fig, ax = plt.subplots(figsize=(10, 5))
            ax.plot(data.index, data["Early start"], linewidth=3, marker="o", label="Planned (early start)")
            if not actual.empty:
                actual_y = actual["Actual Cumulative Cost"] / curve.iloc[-1].max() * 100 if view == "Cumulative %" else actual["Actual Cumulative Cost"]
                ax.plot(actual["Day"], actual_y, linewidth=3, marker="o", color="green", label="Actual")
            ax.plot(data.index, data["Late start"], linewidth=2, linestyle="--", marker="s", color="orange", label="Latest-start limit")
            ax.fill_between(data.index, data["Early start"], data["Late start"], color="orange", alpha=0.15)
            ax.set_title("Project S-Curve")
            ax.set_xlabel("Project Day")
            ax.set_ylabel("Cumulative %" if view == "Cumulative %" else "Cumulative Cost (₱)")
            ax.grid(True)
            ax.legend()
            st.pyplot(fig)
            plt.close(fig)
            st.caption("The shaded band between the early-start and late-start curves is the schedule band: a plan that stays inside it can still finish on time.")
            half = (curve["Early start"] >= curve["Early start"].iloc[-1] / 2).idxmax()
            st.metric("Day when 50% of cost is spent (early start)", f"Day {half}")
            with st.expander("Data table"):
                st.dataframe(curve.round(2), width="stretch")

st.markdown("---")
st.caption("ProjectPERT Estimator v2.0")
