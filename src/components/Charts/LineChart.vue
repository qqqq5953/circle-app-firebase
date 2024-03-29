<template>
  <v-chart
    class="h-60"
    :option="isLoading ? defaultOption : option"
    :loading="isLoading"
    autoresize
  />
</template>

<script>
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import VChart from "vue-echarts";
import { computed, ref, watchEffect } from "vue";

echarts.use([
  CanvasRenderer,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  LineChart,
]);
export default {
  components: {
    VChart,
  },
  props: {
    xAxisData: {
      type: Array,
    },
    seriesData: {
      type: Array,
    },
    currentTab: {
      type: String,
    },
  },
  setup(props) {
    const defaultOption = ref({
      grid: {
        left: "0%",
        right: "0%",
        bottom: "3%",
      },
      xAxis: {
        data: null,
      },
      yAxis: {},
      series: [
        {
          name: "Price",
          type: "line",
          data: null,
        },
      ],
    });

    const option = ref({
      tooltip: {
        trigger: "axis",
      },
      grid: {
        left: "2%",
        right: null,
        bottom: "0%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: null,
        axisLabel: {
          margin: 20,
          align: "center",
          // rotate: 40,
          // overflow: "breakAll",
          // width: 50,
          showMinLabel: false,
          showMaxLabel: false,
        },
      },
      yAxis: {
        type: "value",
        max: null,
        min: null,
        minInterval: null,
      },
      series: [
        {
          name: "Price",
          type: "line",
          stack: "Total",
          data: null,
          itemStyle: {
            color: null,
          },
          areaStyle: {
            opacity: 0.5,
            color: null,
          },
          showSymbol: false,
          zlevel: null,
        },
      ],
      animation: false,
    });

    const min768 = window.matchMedia("(min-width:768px)");

    const isLoading = computed(() => {
      const { xAxisData, seriesData } = props;
      return !xAxisData && !seriesData;
    });

    watchEffect(() => initLineChart());

    function initLineChart() {
      const { xAxisData, seriesData, currentTab } = props;
      if (!xAxisData && !seriesData) return;

      setLineData(xAxisData, seriesData);
      setYAxis(seriesData, currentTab);
      setGraphColor(seriesData);
      setZLevel(currentTab);
      setGrid(currentTab);
      setMinMaxLabel(currentTab);
      setShowSymbol(currentTab);
    }

    function createAreaColor(offsetColor0, offsetColor1) {
      return [
        {
          offset: 0,
          color: offsetColor0,
        },
        {
          offset: 1,
          color: offsetColor1,
        },
      ];
    }

    function setYAxis(seriesData, currentTab) {
      const min = Math.min(...seriesData);
      const max = Math.max(...seriesData);
      const adjMin = Math.floor((min - 1) / 10) * 10;
      const adjMax = Math.ceil((max + 1) / 10) * 10;
      const isDifferenceLessThan10 = Math.abs(max - min) <= 10;

      option.value.yAxis.min = adjMin;
      option.value.yAxis.max = adjMax;
      option.value.yAxis.minInterval =
        currentTab === "5D" || isDifferenceLessThan10 ? 5 : 10;
    }

    function setLineData(xAxisData, seriesData) {
      option.value.xAxis.data = xAxisData;
      option.value.series[0].data = seriesData;
    }

    function setGraphColor(seriesData) {
      const firstClosingPrice = seriesData[0];
      const lastClosingPrice = seriesData.slice(-1)[0];
      const isEndedHigher = firstClosingPrice < lastClosingPrice;

      const lineColor = {
        endHigher: "#dc2626",
        endLower: "#16a34a",
      };
      const areaColor = {
        endHigher: createAreaColor("#ef4444", "#fef2f2"),
        endLower: createAreaColor("#22c55e", "#f0fdf4"),
      };

      const endLineColor = isEndedHigher
        ? lineColor.endHigher
        : lineColor.endLower;
      const endAreaColor = isEndedHigher
        ? areaColor.endHigher
        : areaColor.endLower;

      option.value.series[0].itemStyle.color = endLineColor;
      option.value.series[0].areaStyle.color =
        new echarts.graphic.LinearGradient(0, 0, 0, 1, endAreaColor);
    }

    function setZLevel(currentTab) {
      option.value.series[0].zlevel =
        currentTab === "5D"
          ? 1
          : currentTab === "1M"
          ? 2
          : currentTab === "6M"
          ? 3
          : currentTab === "1Y"
          ? 4
          : 5;
    }

    function setGrid(currentTab) {
      option.value.grid.right = min768.matches
        ? "1%"
        : currentTab === "5D"
        ? "10%"
        : "1%";
    }

    function setMinMaxLabel(currentTab) {
      option.value.xAxis.axisLabel.showMinLabel =
        currentTab === "5D" && !min768.matches;

      option.value.xAxis.axisLabel.showMaxLabel =
        currentTab === "5D" && !min768.matches;
    }

    function setShowSymbol(currentTab) {
      option.value.series[0].showSymbol = currentTab === "5D";
    }

    return { option, defaultOption, isLoading };
  },
};
</script>
