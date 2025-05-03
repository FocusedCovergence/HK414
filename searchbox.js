window.selectedRegions = [];

function initMicroRegionSearch({
    microMeta,
    maxSuggestions = 10,
    maxPool = 5  
}) {
    const pool = [];
    const input   = d3.select("#microSearch");
    const addBtn  = d3.select("#addBtn");
    const sugg    = d3.select("#searchSuggestions");
    const poolDiv = d3.select("#searchPool");

    // suggestion
    input.on("input", function() {
        const term = this.value.trim().toLowerCase();
        if (!term) {
        sugg.html("");
        return sugg.style("display","none");
        }


        let entries = Object.entries(microMeta)
        .filter(([code,m]) =>
            code.includes(term) ||
            m.name.toLowerCase().includes(term) ||
            m.state.toLowerCase().includes(term)
        );

        entries.sort(([codeA,mA],[codeB,mB]) => {
            const nameA  = mA.name.toLowerCase(),  nameB  = mB.name.toLowerCase();
            const stateA = mA.state.toLowerCase(), stateB = mB.state.toLowerCase();
            function rank(code, name, state) {
                if (code.startsWith(term)) return 0;
                if (name.startsWith(term)) return 1;
                if (state.startsWith(term)) return 2;
                if (code.includes(term)) return 3;
                if (name.includes(term)) return 4;
                if (state.includes(term)) return 5;
                return 6;
            }
            return rank(codeA, nameA, stateA) - rank(codeB, nameB, stateB);
        });

        const list = entries.slice(0, maxSuggestions);
        sugg.html("");
        if (!list.length) return sugg.style("display","none");
        sugg.style("display","block");

        list.forEach(([code,m]) => {
        sugg.append("div")
            .text(`${code} – ${m.name} (${m.state})`)
            .style("padding","4px")
            .style("cursor","pointer")
            .on("click", () => {
            input.property("value", code);
            sugg.style("display","none");
            });
        });
    });

    d3.select("body").on("click", event => {
        if (!event.target.closest("#searchBox")) {
        sugg.style("display","none");
        }
    });

    addBtn.on("click", () => {
        const code = input.property("value").trim();
        if (!microMeta[code])       return alert("Not a valid code.");
        if (pool.includes(code))     return alert("Already added.");
        if (pool.length >= maxPool)  return alert(`At most ${maxPool} items.`);
        pool.push(code);
        renderPool();
    });

    // select pool
    function renderPool() {
        poolDiv.html("");
        pool.forEach(code => {
            const m = microMeta[code];
            const item = poolDiv.append("div")
                .style("border","1px solid #999")
                .style("border-radius","4px")
                .style("padding","4px 8px")
                .style("background","#f0f0f0")
                .style("display","flex")
                .style("align-items","center")
                .style("gap","6px");

            item.append("span")
                .text(`${code} – ${m.name} (${m.state})`);


            item.append("button")
                .text("Delete")
                .style("padding","2px 6px")
                .style("font-size","10px")
                .on("click", () => {
                    pool.splice(pool.indexOf(code), 1);
                    renderPool();
                });
        });
        window.selectedRegions = [...pool];
    }
}
