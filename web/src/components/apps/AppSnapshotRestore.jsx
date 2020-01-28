import React, { Component } from "react";
import { graphql, compose, withApollo } from "react-apollo";
import { withRouter } from "react-router-dom";
import Helmet from "react-helmet";
import { Line } from "rc-progress";
import Loader from "../shared/Loader";
import { restoreDetail } from "../../queries/SnapshotQueries";

class AppSnapshotRestore extends Component {
  componentDidMount() {
    this.props.restoreDetail.startPolling(2000);
  }

  render() {
    const { restoreDetail } = this.props;

    if (restoreDetail?.loading) {
      return (
        <div className="flex-column flex1 alignItems--center justifyContent--center">
          <Loader size="60" />
        </div>
      )
    }

    return (
      <div className="container flex-column flex1 u-overflow--auto u-paddingTop--30 u-paddingBottom--20 alignItems--center">
        <Helmet>
          <title>{`${this.props.app.name} Snapshots Restore`}</title>
        </Helmet>
        <p className="u-fontWeight--bold u-color--tuna u-fontSize--larger u-lineHeight--normal u-marginBottom--10"> Application restore in progress </p>
        <p className="u-fontSize--normal u-fontWeight--medium u-color--dustyGray u-lineHeight--normal"> After all volumes have been restored you will need to log back in to the admin console. </p>
        <div className="flex flex-column  u-marginTop--40">
          {restoreDetail?.restoreDetail?.volumes?.length === 0 &&
            <div className="flex-column flex1 alignItems--center justifyContent--center">
              <Loader size="60" />
            </div>
          }
          {restoreDetail?.restoreDetail?.volumes?.map((volume, i) => {
            const strokeColor = volume.completionPercent === 100 ? "#44BB66" : "#326DE6";
            const minutes = Math.floor(volume.timeRemainingSeconds / 60);
            const remainingTime = volume.timeRemainingSeconds < 60 ? `${volume.timeRemainingSeconds} seconds remaining` : `${minutes} minutes remaining`;
            const percentage = volume.completionPercent ? volume.completionPercent : 0;

            return (
              <div className="flex flex1 u-marginTop--30" key={`${volume.name}-${i}`}>
                <div className="flex flex1">
                  <p className="u-fontSize--normal u-color--tuna u-fontWeight--bold u-lineHeight--bold u-marginRight--10">Restoring volume: {volume.name}</p>
                </div>
                <div className="flex flex1 flex-column justifyContent--center">
                  <Line percent={percentage} strokeWidth="3" strokeColor={strokeColor} />
                  {volume.timeRemainingSeconds !== 0 ?
                    <div className="flex justifyContent--center u-fontSize--smaller u-fontWeight--medium u-color--silverSand u-marginTop--5"> {volume.timeRemainingSeconds ? remainingTime : null}</div>
                    :
                    <div className="flex justifyContent--center u-fontSize--smaller u-fontWeight--medium u-color--silverSand u-marginTop--5"> Complete </div>
                  }
                </div>
                {volume.completionPercent === 100 ?
                  <span className="icon checkmark-icon u-marginLeft--10"></span>
                  :
                  <span className="u-fontSize-small u-fontWeight--medium u-color--silverSand u-marginLeft--10">{volume.completionPercent ? `${volume.completionPercent}%` : null}</span>
                }
              </div>
            );
          })}
        </div>
        <div>
        </div>
      </div>
    );
  }
}

export default compose(
  withApollo,
  withRouter,
  graphql(restoreDetail, {
    name: "restoreDetail",
    options: ({ app }) => {
      const appId = app.id
      return {
        variables: { appId },
        fetchPolicy: "no-cache"
      }
    }
  }),
)(AppSnapshotRestore);
