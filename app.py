import dash
from dash import dcc, html, Input, Output
import plotly.express as px
import pandas as pd
import json



dengue_df = pd.read_csv('data/dengue_long.csv')
with open('data/brazil_microregions.geojson', 'r', encoding='utf-8') as f:
    geojson_data = json.load(f)


app = dash.Dash(__name__)
server = app.server

## Layout
app.layout = html.Div([
    html.H1("Brazil Dengue Dashboard", style={'textAlign': 'center'}),
    html.Label("Select Week:"),
    dcc.Slider(
        id='week-slider',
        min=dengue_df['week_id'].min(),
        max=dengue_df['week_id'].max(),
        value=dengue_df['week_id'].min(),
        marks={int(w): str(w) for w in sorted(dengue_df['week_id'].unique())[::10]},
        step=1
    ),
    dcc.Graph(id='choropleth-map')
])


@app.callback(
    Output('choropleth-map', 'figure'),
    Input('week-slider', 'value')
)
def update_map(week):
    filtered_df = dengue_df[dengue_df['week_id'] == week]

    fig = px.choropleth(
        filtered_df,
        geojson=geojson_data,
        locations='micro_code',
        color='cases',
        color_continuous_scale="Reds",
        featureidkey="properties.micro_code",
        projection="mercator",
        title=f"Dengue Cases - Week {week}"
    )
    fig.update_geos(fitbounds="locations", visible=False)
    fig.update_layout(margin={"r":0,"t":40,"l":0,"b":0})
    return fig


if __name__ == '__main__':
    app.run_server(debug=True)