const width = 800, height = 800;

const svg = d3.select("#map").append("svg")
    .attr("width", width)
    .attr("height", height);

let geoData, dengueData;

// const baseColors = d3.range(0, 10).map(i => d3.interpolateRainbow(i/10));

let currentIdx = 0;

let isPlaying = false;
let interval = null;

let subInterval = null;

const zoomTransforms = {};

let skipSmoothOnce = false;

const top10Charts = {};

const clickedHistory = [];

let currentData = {};

// THESE DOMAINS ARE PRE-CALCULATED AND SET TO GET A CLEAR VISUALIZATION
const featureDomains = {
    ndvi: [-0.00688, 0.11906, 0.21049, 0.28609, 0.36788, 0.78246],
    humidity: [21.7655, 46.9578, 65.3740, 75.2863, 81.9774, 97.2840],
    temperature_mean: [5.02, 11.04, 17.07, 23.09, 29.12, 35.15],
    wind_speed: [0.55697, 1.09685, 1.61776, 2.11714, 2.78454, 9.75973],
    temperature_min: [-4,  10,  15,  20,  25,  30],
    temperature_max: [10, 20, 25, 30, 35, 42.44],
    pressure: [88474, 91328, 94182, 97037, 99892, 102746],
    rainy_days: [0, 1.4, 2.8, 4.2, 5.6, 7],
    precipitation: [0, 1, 5, 20, 100, 455],
    dengue: [0, 1, 10, 100, 1000, 57949]
    // dengue: [0, 2, 4, 11, 40, 57949]

}

// load files
Promise.all([
    d3.json("data/brazil_microregions_simplified_v3.geojson"),
    d3.csv("data/composed_features_new.csv", d => {
        const parsed = {
            week_id: +d.week_id,
            micro_code: d.micro_code
        };

        for (const key in d) {
            if (key !== "week_id" && key !== "micro_code") {
                // parsed[key] = +d[key];
                parsed[key] = d[key] === "" ? NaN : +d[key];
            }
        }
        return parsed;
    })
]).then(([geo, data]) => {
    geoData = geo;
    dengueData = data;

    const dataByWeekAndCode = d3.rollup(
        dengueData,
        v => v[0],
        d => d.week_id,
        d => d.micro_code
    );
    window.dataByWeekAndCode = dataByWeekAndCode;
    
    const microMeta = {};
    geoData.features.forEach(f => {
        const { CD_MICRO, NM_MICRO, SIGLA } = f.properties;
        microMeta[CD_MICRO] = {
        name: NM_MICRO,
        state: SIGLA
        };
    });

    // helper func for code, name, state
    function getRegionLabel(code) {
        const m = microMeta[code] || {};
        return `${code}: ${m.name || ""} (${m.state || ""})`;
    }


    window.microMeta = microMeta;
    window.getRegionLabel = getRegionLabel;

    initMicroRegionSearch({
        microMeta: window.microMeta,
        maxSuggestions: 10,
        maxPool: 5
    });

    // extract features
    const allFeatures = Object.keys(data[0]).filter(k => k !== "week_id" && k !== "micro_code");

    // const baseColors = d3.range(0, allFeatures.length).map(i => d3.interpolateRainbow(i / allFeatures.length));

    const N = allFeatures.length;

    const baseColors = d3.quantize(d3.interpolateTurbo, N);

    const featureScales = {};

    // color by number
    // allFeatures.forEach((feature, i) => {
    //     const domain = featureDomains[feature];
    //     const base = baseColors[i]; 
    //     const stops = d3.range(domain.length)
    //                     .map(j => d3.interpolateRgb("#fff", base)(j / (domain.length - 1)));
    //     featureScales[feature] = d3.scaleLinear()
    //                             .domain(domain)
    //                             .range(stops);
    // });


    const featureHues = allFeatures.map((f,i) =>
        Math.round(i * 360 / allFeatures.length)
    );

    function makeInterpolator(hue) {
        const start = d3.hcl(hue, 0, 100);
        const end   = d3.hcl(hue, 70, 30);
        return d3.interpolateHcl(start, end);
    }

    allFeatures.forEach((feature, i) => {

        const domain = featureDomains[feature]; 
        const interp = makeInterpolator(featureHues[i]);
        const stops = d3.range(domain.length)
                        .map(j => interp(j / (domain.length - 1)));

        featureScales[feature] = d3.scaleLinear()
                                    .domain(domain)
                                    .range(stops);
    });


    const legendData = {};
    allFeatures.forEach(feature => {
        const scale = featureScales[feature];
        legendData[feature] = {
            domain: scale.domain(),
            colors: scale.range()
        };
    });
    window.legendData = legendData;


    window.featureScales = featureScales;

    // create checkboxes
    const checkGroup = d3.select("#featureChecks");
    checkGroup.selectAll("label")
        .data(allFeatures)
        .enter()
        .append("label")
        .style("margin-right", "12px")
        .html(d => `<input type="checkbox" name="feature" value="${d}"> ${abbFeatureName(d)}`);



    // check dengue default
    d3.select(`#featureChecks input[value="dengue"]`).property("checked", true);


    // slider bar max/min
    const weeks = Array.from(new Set(data.map(d => d.week_id)))
                   .sort((a,b) => a - b);

    setupFeatureCheckboxListener(weeks, renderAllSelectedMaps);

    setupPlaybackControls(weeks, renderAllSelectedMaps);

    setupCustomProgressBar(weeks, renderAllSelectedMaps);

    setupYearTicks(weeks);


    const yearWeekList = calculateWeek(weeks[0]);
    d3.select("#yearLabel").text(yearWeekList[0]);
    d3.select("#weekLabel").text(yearWeekList[1]);

    // d3.select("#weekLabel").text(weeks[0]);
    renderAllSelectedMaps(["dengue"], weeks[0]);

});




const mapGroups = {};  

function renderAllSelectedMaps(selectedFeatures, week, enableTransition = false) {
    window.currentWeekId = week;

    const container = d3.select("#map-container");

    Object.keys(mapGroups).forEach(feature => {
        if (!selectedFeatures.includes(feature)) {
            container.select(`#map-${feature}`).remove();
            delete mapGroups[feature];
        }
    });
    const currentData = Object.fromEntries(
        dengueData
        .filter(d => d.week_id === week)
        .map(d => [d.micro_code, d])
    );

    selectedFeatures.forEach(feature => {

        if (!mapGroups[feature]) {
            const mapDiv = container.append("div")
                .attr("id", `map-${feature}`)
                .attr("class", "vis-block")
                .style("flex", "1 1 calc(25% - 20px)")
                .style("max-width", "670.34px")
                .style("min-width", "250px");

            const featureName = abbFeatureName(feature)

            mapDiv.append("div")
                .text(featureName)
                .style("font-weight", "bold")
                .style("margin-bottom", "5px");

            const svg = mapDiv.append("svg")
                .attr("width", width)
                .attr("height", height);

            const g = svg.append("g");
            // svg.call(makeZoomBehavior(feature, g));

            // new added
            const zoomBehavior = makeZoomBehavior(feature, g);
            svg.call(zoomBehavior)


            if (zoomTransforms[feature]) {
                svg.call(d3.zoom().transform, zoomTransforms[feature]);
            }

            // const projection = d3.geoMercator()
            //                     .fitSize([width, height], geoData)
            //                     .translate([width/2 + 800, height/2-200]);
                                
            const projection = d3.geoMercator().fitSize([width, height], geoData);
            const pathGen = d3.geoPath().projection(projection);

            const paths = g.selectAll("path")
                .data(geoData.features, d => d.properties.CD_MICRO)
                .enter()
                .append("path")
                .attr("d", pathGen)
                .attr("stroke", "#999")
                .attr("stroke-width", 0.5)
                .attr("fill-opacity", 0.85)
                .classed("micro_region", true)
                .on("click", (event,d) => {
                    if (event.defaultPrevented) return;
                    // console.log("Clicked:", d.properties.CD_MICRO);
                    const code = d.properties.CD_MICRO;
                    const info = microMeta[code];

                    const existingIdx = clickedHistory.findIndex(e => e.code === code);
                    if (existingIdx !== -1) {
                        clickedHistory.splice(existingIdx, 1);
                    }
                    clickedHistory.unshift({ code, ...info });

                    // if (clickedHistory.length > 10) {
                    //     clickedHistory.pop();
                    // }

                    renderClickHistory();
                })
                .on("mouseover", (event,d) => {
                    window.lastHoveredCode = d.properties.CD_MICRO;
                    window.lastHoveredPos  = { x: event.pageX, y: event.pageY };
                    updateTooltip(event, d);
                })
                .on("mousemove", (event,d) => {
                    window.lastHoveredPos = { x: event.pageX, y: event.pageY };
                    updateTooltip(event, d);
                })
                .on("mouseout", () => {
                    window.lastHoveredCode = null;
                    d3.select("#tooltip").style("display", "none");
                });
            
            drawLegend(svg, feature);
            // mapGroups[feature] = {g, paths};

            mapGroups[feature] = {g, paths, svg, zoomBehavior};
        }

        const color = featureScales[feature];

        if(enableTransition){
            mapGroups[feature].g.selectAll("path")
                        .transition()
                        .duration(500)
                        .attr("fill", d => {
                            const code = d.properties.CD_MICRO;
                            const rec  = currentData[code] || {};
                            const v    = rec[feature];
                            if (v == null || isNaN(v)) return "#111";
                            return color(v);
                        });


                        // .attr("fill", d => {
                        //     const code = d.properties.CD_MICRO;
                        //     return color((currentData[code] || {})[feature] || 0);
                        // });
        }else{
            mapGroups[feature].g.selectAll("path")
                        .attr("fill", d => {
                            const code = d.properties.CD_MICRO;
                            const rec  = currentData[code] || {};
                            const v    = rec[feature];
                            if (v == null || isNaN(v)) return "#111";
                            return color(v);
                        });
                        // .attr("fill", d => {
                        //     const code = d.properties.CD_MICRO;
                        //     return color((currentData[code] || {})[feature] || 0);
                        // });
        }


        



        // mapGroups[feature].g.selectAll("path")
        //                 .attr("fill", d => {
        //                     const code = d.properties.CD_MICRO;
        //                     return color((currentData[code] || {})[feature] || 0);
        //                 });
    });

    if (window.lastHoveredCode) {
        // find the feature object for that code
        const f = geoData.features.find(f => f.properties.CD_MICRO === window.lastHoveredCode);
        // simulate an event at the last mouse position
        const pseudoEvent = { pageX: window.lastHoveredPos.x, pageY: window.lastHoveredPos.y };
        updateTooltip(pseudoEvent, f);
    }

    updateTop10Histograms(selectedFeatures, week);
}



function setupFeatureCheckboxListener(weeks, renderAllSelectedMaps) {
    d3.selectAll("#featureChecks input").on("change", function () {
        const selected = d3.selectAll("#featureChecks input")
            .filter(function () { return this.checked; })
            .nodes()
            .map(n => n.value);

        // const currentIdx = +d3.select("#weekSlider").property("value");
        const week = weeks[currentIdx];
        renderAllSelectedMaps(selected, week);
    });
}

function makeZoomBehavior(feature, g) {
    return d3.zoom()
        .scaleExtent([0.45, 8])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
            zoomTransforms[feature] = event.transform;
        });
}


function startAutoPlay(weeks, renderMapFn) {
    if (isPlaying) return;
    isPlaying = true;
    skipSmoothOnce = false;
    d3.select("#playButton").text("⏸");
    interval = setInterval(() => {
        const maxIdx = weeks.length - 1;
        const prevIdx = currentIdx;

        // currentIdx = (currentIdx + 1) > maxIdx ? 0 : currentIdx + 1;
        if (currentIdx < maxIdx) {
            currentIdx++;
        } else {
            // stop at last frame
            stopAutoPlay();
            return;
        }


        const realWeek = weeks[currentIdx];

        const yearWeekList = calculateWeek(realWeek);
        d3.select("#yearLabel").text(yearWeekList[0]);
        d3.select("#weekLabel").text(yearWeekList[1]);


        // d3.select("#weekLabel").text(realWeek);
        const selected = d3.selectAll("#featureChecks input")
                            .filter(function() { return this.checked; })
                            .nodes().map(n => n.value);
        renderMapFn(selected, realWeek, true);
        updateProgressBar(currentIdx, weeks.length);

        // tween
        clearInterval(subInterval);
        if (!skipSmoothOnce) {
        smoothAdvance(prevIdx, currentIdx, weeks);
        } else {
        skipSmoothOnce = false;
        }
    }, 1000);
}

function stopAutoPlay() {
    if (!isPlaying) return;
    clearInterval(interval);
    isPlaying = false;
    d3.select("#playButton").text("▶");
}


function setupPlaybackControls(weeks, renderMapFn) {
    // let isPlaying = false;
    // let interval = null;


    const playButton = d3.select("#playButton");
    playButton.on("click", () => {
        if (isPlaying) {
            stopAutoPlay();
        } else {
            if (currentIdx === weeks.length - 1) {
                currentIdx = 0;
                // const firstWeek = weeks[0];

                const yearWeekList = calculateWeek(weeks[0]);
                d3.select("#yearLabel").text(yearWeekList[0]);
                d3.select("#weekLabel").text(yearWeekList[1]);


                // d3.select("#weekLabel").text(weeks[0]);
                updateProgressBar(0, weeks.length);
                const selected = d3.selectAll("#featureChecks input")
                                    .filter(function() { return this.checked; })
                                    .nodes().map(n => n.value);
                renderMapFn(selected, weeks[0]);
            }      
            startAutoPlay(weeks, renderMapFn);
        }
    });
}


function setupCustomProgressBar(weeks, renderMapFn) {
    const wrapper = d3.select("#progressBarWrapper");
    const fill = d3.select("#progressBarFill");

    let isDragging = false;
    let wasPlayingBeforeDrag = false;

    function updateFromX(x) {
        const rect = wrapper.node().getBoundingClientRect();
        const percent = Math.min(Math.max(x / rect.width, 0), 1);
        const idx = Math.round(percent * (weeks.length - 1));

        currentIdx = idx;

        const yearWeekList = calculateWeek(weeks[idx]);
        d3.select("#yearLabel").text(yearWeekList[0]);
        d3.select("#weekLabel").text(yearWeekList[1]);

        // d3.select("#weekLabel").text(weeks[idx]);

        const selected = d3.selectAll("#featureChecks input")
                            .filter(function () { return this.checked; })
                            .nodes()
                            .map(n => n.value);

        renderMapFn(selected, weeks[idx]);
        updateProgressBar(idx, weeks.length, true);
    }

    const dragger = d3.drag()
        .on("start", (event) => {
            clearInterval(subInterval);
            wasPlayingBeforeDrag = isPlaying;
            if (isPlaying) {
                stopAutoPlay();
            }
            skipSmoothOnce = true;
            d3.select("body").style("user-select", "none");
            updateFromX(event.x);
        })
        .on("drag", (event) => {
            updateFromX(event.x);
        })
        .on("end", () => {
            d3.select("body").style("user-select", null);
            if (wasPlayingBeforeDrag) {
                // skipSmoothOnce = true;
                // d3.select("#playButton").dispatch("click");
                startAutoPlay(weeks, renderMapFn);
            }
        });

    wrapper.call(dragger);
}

function updateProgressBar(currentIdx, total, immediate = false) {
    const progress = (currentIdx / (total - 1)) * 100;
    const bar = d3.select("#progressBarFill");

    if (immediate) {
        bar.style("transition", "none");
    } else {
        bar.style("transition", "width 0.3s linear");
    }

    bar.style("width", `${progress}%`);
}

// ??? 
function smoothAdvance(fromIdx, toIdx, weeks) {
    let frame = 0;
    const totalFrames = 30;
    const start = fromIdx;
    const end = toIdx;

    clearInterval(subInterval);

    subInterval = setInterval(() => {
        frame++;
        const t = frame / totalFrames;
        const progress = start + (end - start) * t;

        updateProgressBar(progress, weeks.length);

        if (frame >= totalFrames) {
            clearInterval(subInterval);
        }
    }, 1000 / totalFrames);
}

function calculateWeek(passedWeek){
    let year = Math.floor(passedWeek/100);
    let week = passedWeek%100;
    return [year, week]
}

function abbFeatureName(name){
    const nameMap = {
        dengue: "Weekly Dengue Cases",
        pressure: "Pressure",
        rainy_days: "Num Rainy Days",
        precipitation: "Precipitation",
        temperature_max: "Max Temperature",
        temperature_min: "Min Temperature",
        wind_speed: "Wind Speed",
        temperature_mean: "Avg Temperature",
        humidity: "Humidity",
        ndvi: "Normalized Difference Vegetation Index"
    };

    return nameMap[name] || "UNKNOWN";
}


d3.select("#toggleTop10Btn").on("click", () => {
    const container = d3.select("#top10Container");
    const visible = container.style("display") !== "none";
    container.style("display", visible ? "none" : "flex");
    d3.select("#toggleTop10Btn").text(visible ? "Show Top 10 Regions" : "Hide Top 10 Regions");
});


function updateTop10Histograms(selectedFeatures, week) {
    const container = d3.select("#top10Container");

    Object.keys(top10Charts).forEach(feature => {
        if (!selectedFeatures.includes(feature)) {
            container.select(`#top10-${feature}`).remove();
            delete top10Charts[feature];
        }
    });

    const currentData = dengueData.filter(d => d.week_id === week);
    const width = 300, height = 250;
    const margin = { top: 10, right: 60, bottom: 30, left: 160 };

    selectedFeatures.forEach(feature => {
        let block = container.select(`#top10-${feature}`);
        if (block.empty()) {
            block = container.append("div")
                            .attr("id", `top10-${feature}`)
                            .attr("class", "vis-block")
                            .style("flex", "1 1 calc(25% - 20px)")
                            .style("max-width", "335.17px")
                            .style("min-width", "250px");

            top10Charts[feature] = true;
        }

        block.select("svg").remove();

        const svg = block.append("svg")
                        .attr("width", width)
                        .attr("height", height);

        svg.append("text")
            .attr("x", width/2).attr("y", margin.top + 4)
            .attr("text-anchor", "middle")
            .style("font-weight", "bold")
            .text(abbFeatureName(feature));

        // for NaN value
        // const top10 = [...currentData].filter(d => !isNaN(d[feature]))
        //                             .sort((a,b) => b[feature] - a[feature])
        //                             .slice(0,10);

        const top10 = [...currentData].sort((a,b) => {
            const va = isNaN(a[feature]) ? -Infinity : a[feature];
            const vb = isNaN(b[feature]) ? -Infinity : b[feature];
            return vb - va;
        })
        .slice(0, 10);

        const x = d3.scaleLinear()
                    .domain([0, d3.max(top10,d=>d[feature])])
                    .range([0, width - margin.left - margin.right]);

        const y = d3.scaleBand()
                    .domain(top10.map(d=>d.micro_code))
                    .range([margin.top, height - margin.bottom])
                    .padding(0.1);

        const g = svg.append("g")
                    .attr("transform", `translate(${margin.left},10)`);


        g.selectAll("rect")
        .data(top10)
        .enter().append("rect")
        .attr("y", d => y(d.micro_code))
        .attr("height", y.bandwidth())
        .attr("width", d =>
            isNaN(d[feature]) 
                ? 0 
                : x(d[feature])
        )
        .attr("fill", d =>
            isNaN(d[feature])
                ? "#ccc"  
                : featureScales[feature](d[feature])
        );


        g.selectAll(".bar-label")
        .data(top10)
        .enter().append("text")
        .attr("class", "bar-label")
        .attr("x", d =>
            isNaN(d[feature]) 
                ? 4
                : x(d[feature]) + 4
        )
        .attr("y", d => y(d.micro_code) + y.bandwidth()/2 + 4)
        .text(d => isNaN(d[feature]) ? "N/A" : d[feature].toFixed(1))
        .style("font-size","10px");



        // y-axis
        const yAxis = d3.axisLeft(y)
                        .tickFormat(d=> getRegionLabel(d));
        g.append("g").call(yAxis)
                    .selectAll("text")
                        .style("font-size","10px");
    });
}


function renderClickHistory() {
    const list = d3.select("#clickedList");
    list.html("");

    // const title = container.append("h3").text("Micro-regions You've Viewed:");

    // const list = container.append("ul");

    clickedHistory.slice(0,50).forEach(entry => {
        list.append("li").text(
            `${entry.code} – ${entry.name} (${entry.state})`
        );
    });
}




function drawLegend(gOrSvg, feature) {
    // 1. 找到根 <svg>
    const root = (gOrSvg.node().nodeName.toLowerCase() === 'svg'
        ? gOrSvg.node()
        : gOrSvg.node().ownerSVGElement);
    const svg = d3.select(root);

    // 2. 抽 domain & colors
    const { domain, colors } = window.legendData[feature];
    const steps = domain.length - 1;      // 5 色块

    // 3. 参数
    const legendW = 12;                  // 色块宽度
    const stepH   = 30;                  // 色块高度
    const legendH = stepH * steps;       // 总高度
    const margin  = 10;                  // 四周留白

    // 4. 从 SVG 读宽高
    const svgW = +svg.attr("width");
    //const svgH = +svg.attr("height");  // 不用

    // 5. 计算左上角放置点
    const offsetX = margin;
    const offsetY = margin;

    // 6. 在根 SVG 上插入 <g> 并置于最前
    const legendG = svg.append("g")
        .attr("class", "legend")
        .attr("transform", `translate(${offsetX},${offsetY})`)
        .raise();

    // 7. 从下往上画矩形（低值在下，高值在上）
    for (let i = 0; i < steps; i++) {
        const yBlock = legendH - (i + 1) * stepH;
        legendG.append("rect")
        .attr("x", 0)
        .attr("y", yBlock)
        .attr("width", legendW)
        .attr("height", stepH)
        .attr("fill", colors[i]);
    }

    // 8. 在色块边界处画 label：位置 = 边界 y + 文本微调
    for (let i = 0; i <= steps; i++) {
        const yLabel = legendH - i * stepH + 4;  // +4 px 向下微调
        legendG.append("text")
        .attr("x", legendW + 4)
        .attr("y", yLabel)
        .attr("dy", "0em")
        .style("font-size", "10px")
        .text(domain[i].toFixed(1));
    }
}


d3.select("#genLineBtn").on("click", () => {

    if (d3.select("#searchPool").selectAll("*").empty()) {
        alert("Empty pool, please select regions");
        return;
    }
    
    // generate checkboxes
    const controls = d3.select("#lineControls");
    if (controls.selectAll("input").empty()) {
        const allFeatures = Object.keys(dengueData[0])
                                    .filter(k => k !== "week_id" && k !== "micro_code");
        allFeatures.forEach((feature, i) => {
            const chkId = `linechartCheckbox-${feature}`;
            const lbl = controls.append("label");
            lbl.append("input")
                .attr("id", chkId)
                .attr("type","checkbox")
                .attr("value",feature)
                .property("checked", feature === "dengue");
            lbl.append("span").text(abbFeatureName(feature));
        });
        controls.selectAll("input").on("change", updateLineCharts);
    }

    updateLineCharts();
});


d3.select("#clearLineBtn").on("click", () => {
    d3.select("#lineControls").html("");
    d3.select("#lineChartContainer").html("");
    d3.select("#lineLegend").html("");
});


function updateLineCharts() {
    const selectedFeatures = d3.selectAll("#lineControls input:checked").nodes()
        .map(n => n.value);
    const regions = window.selectedRegions;
    const container = d3.select("#lineChartContainer");
    const legendDiv = d3.select("#lineLegend");


    legendDiv.html("");
    container.html("");
    if (!regions.length || !selectedFeatures.length) return;

    const color = d3.scaleOrdinal(d3.schemeCategory10)
        .domain(regions);


    regions.forEach(region => {
        const item = legendDiv.append("div").attr("class","line-legend-item");
        item.append("div")
            .attr("class","line-legend-color")
            .style("background", color(region));
        item.append("span").text(region);
    });

    const margin = { top: 30, right: 20, bottom: 30, left: 40 };
    const w = 320, h = 200;

    const allWeeks = Array.from(
        new Set(
        dengueData
            .filter(d => regions.includes(d.micro_code))
            .map(d => d.week_id)
        )
    ).map(Number).sort((a,b)=>a-b);


    const byRegionWeek = {};
    dengueData
        .filter(d => regions.includes(d.micro_code))
        .forEach(d => {
        const code = d.micro_code;
        if (!byRegionWeek[code]) byRegionWeek[code] = {};
        const rec = byRegionWeek[code];
        if (!rec[d.week_id]) rec[d.week_id] = { count: 0 };
        rec[d.week_id].count++;
        selectedFeatures.forEach(f => {
            rec[d.week_id][f] = (rec[d.week_id][f] || 0) + d[f];
        });
        });


    selectedFeatures.forEach(feature => {
        const chartDiv = container.append("div")
            .attr("class","line-chart")
            .style("width", "350px")
            .style("flex", "none");

        const svg = chartDiv.append("svg")
        .attr("width", w)
        .attr("height", h);

        const dataByRegion = {};
        regions.forEach(code => {
            const rec = byRegionWeek[code] || {};
            dataByRegion[code] = allWeeks.map(week => ({
                week,
                value: rec[week]
                    ? rec[week][feature] / rec[week].count
                    : 0
            }));
        });


        const x = d3.scaleLinear()
        .domain(d3.extent(allWeeks))
        .range([margin.left, w - margin.right]);

        // const xAxis = d3.axisBottom(x)
        //   .ticks(4)
        //   .tickFormat(d => Math.floor(d / 100));

        const xAxis = d3.axisBottom(x)
                        .ticks(4)
                        .tickFormat(d => {
                            const s = d.toString();
                            return s.length >= 4 ? s.slice(0, 4) : s;
                        });

        const allVals = regions.flatMap(code =>dataByRegion[code].map(d => d.value));
        const y = d3.scaleLinear()
        .domain(d3.extent(allVals)).nice()
        .range([h - margin.bottom, margin.top]);

        const yAxis = d3.axisLeft(y).ticks(4);

        const g = svg.append("g").attr("transform", `translate(15,0)`);

        g.append("g")
            .attr("transform", `translate(0,${h - margin.bottom})`)
            .call(xAxis);

        g.append("g")
            .attr("transform", `translate(${margin.left},0)`)
            .call(d3.axisLeft(y).ticks(4));

        const lineGen = d3.line()
                        .defined(d => !isNaN(d.value))
                        .x(d => x(d.week))
                        .y(d => y(d.value));

        regions.forEach(region => {
            g.append("path")
                .datum(dataByRegion[region])
                .attr("fill", "none")
                .attr("stroke", color(region))
                .attr("stroke-width", 1.2)
                .attr("d", lineGen);
        });


        if (feature === "dengue") {
            const cumDataByRegion = {};
            regions.forEach(code => {
                let sum = 0;
                cumDataByRegion[code] = dataByRegion[code].map(d => {
                    sum += isNaN(d.value) ? 0 : d.value;
                    return { week: d.week, value: sum };
                });
            });

            const allCumValues = regions.flatMap(code =>
                cumDataByRegion[code].map(d => d.value)
            );
            const yCum = d3.scaleLinear()
                .domain([0, d3.max(allCumValues)])
                .nice()
                .range([h - margin.bottom, margin.top]);

            const cumChartDiv = container.append("div")
                .attr("class", "line-chart")
                .style("width", "350px")
                .style("flex", "none");

            const cumSvg = cumChartDiv.append("svg")
                .attr("width", w)
                .attr("height", h);

            const cumG = cumSvg.append("g")
                .attr("transform", `translate(15,0)`);

            cumG.append("g")
                .attr("transform", `translate(0,${h - margin.bottom})`)
                .call(xAxis);

            cumG.append("g")
                .attr("transform", `translate(${margin.left},0)`)
                .call(d3.axisLeft(yCum).ticks(4));

            const cumLineGen2 = d3.line()
                .defined(d => !isNaN(d.value))
                .x(d => x(d.week))
                .y(d => yCum(d.value));

            regions.forEach(region => {
                cumG.append("path")
                    .datum(cumDataByRegion[region])
                    .attr("fill", "none")
                    .attr("stroke", color(region))
                    .attr("stroke-width", 1.2)
                    .attr("d", cumLineGen2);
            });

            cumSvg.append("text")
                .attr("x", w / 2)
                .attr("y", margin.top - 10)
                .attr("text-anchor", "middle")
                .style("font-size", "12px")
                .style("font-weight", "bold")
                .text("Cumulative Dengue Cases");
        }



        svg.append("text")
        .attr("x", w / 2)
        .attr("y", margin.top - 10)
        .attr("text-anchor", "middle")
        .style("font-size","12px")
        .style("font-weight","bold")
        .text(abbFeatureName(feature));
    });
}


function setupYearTicks(weeks) {
    const yearTicks = d3.select("#progressYearTicks");
    yearTicks.html("");

    const yearWeekCounts = {
        2014: 53, 2015: 52, 2016: 52, 2017: 52, 2018: 52,
        2019: 52, 2020: 53, 2021: 52, 2022: 52, 2023: 52, 2024: 52
    };

    const totalWeeks = weeks.length;
    let weekIndex = 0;

    Object.entries(yearWeekCounts).forEach(([year, count]) => {
        const leftPercent = (weekIndex / (totalWeeks - 1)) * 100;

        yearTicks.append("div")
            .style("position", "absolute")
            .style("left", `${leftPercent}%`)
            .style("transform", "translateX(-50%)")
            .style("font-size", "10px")
            .style("color", "#666")
            .text(year);

        weekIndex += count;
    });
}


function updateTooltip(event, d) {
    const code = d.properties.CD_MICRO;
    const info = microMeta[code] || {};

    const weekId = window.currentWeekId;

    const year = Math.floor(weekId / 100);
    const week = weekId % 100;

    const record =  window.dataByWeekAndCode.get(weekId)?.get(code);

    let html = `<strong>${code}</strong> ${info.name} (${info.state})<br>`;
    html += `<em>Year:</em> ${year}, <em>Week:</em> ${week}`;
    
    if (record) {
        html += "<br><br>" + Object.entries(record)
        .filter(([k]) => k!=="micro_code" && k!=="week_id")
        .map(([k,v]) => `${abbFeatureName(k)}: ${isNaN(v) ? "N/A" : v.toFixed(2)}`)
        .join("<br>");
    }
    
    // `${abbFeatureName(k)}: ${v.toFixed(2)}`

    d3.select("#tooltip")
        .html(html)
        .style("display", "block")
        .style("left",  (window.lastHoveredPos.x + 10) + "px")
        .style("top",   (window.lastHoveredPos.y + 10) + "px");
}



function findAndHighlight(code) {
    if (!code) return;

    Object.values(mapGroups).forEach(({ svg, g, zoomBehavior }) => {
        const path = g.selectAll("path")
                    .filter(d => d.properties.CD_MICRO === code);
        if (path.empty()) return;

        const bbox = path.node().getBBox();
        const svgNode = svg.node();
        const { width: w, height: h } = svgNode.getBoundingClientRect();


        const paddingFactor = 1.2;
        const rawK = Math.min(
        w  / (bbox.width  * paddingFactor),
        h  / (bbox.height * paddingFactor)
        );
        const k = Math.max(0.45, Math.min(1.1, rawK));

        const centerX = bbox.x + bbox.width  / 2;
        const centerY = bbox.y + bbox.height / 2;
        const tx = w/2 - k * centerX;
        const ty = h/2 - k * centerY;
        const t  = d3.zoomIdentity.translate(tx, ty).scale(k);

        svg.transition().duration(750)
        .call(zoomBehavior.transform, t);

        document.getElementById('map-container').scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });

        path.classed("highlighted", true);
        setTimeout(() => {
            path.classed("highlighted", false);
        }, 3500);
    });
}

d3.select("#findBtn").on("click", () => {
    const code = d3.select("#microSearch")
                    .property("value")
                    .trim();
    if (!microMeta[code]) return alert("Not a valid code.");
    findAndHighlight(code);
});