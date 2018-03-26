import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Animated, Dimensions, Modal, PanResponder, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View, Easing } from 'react-native';

const DRAG_DISMISS_THRESHOLD = 150;
const STATUS_BAR_OFFSET = (Platform.OS === 'android' ? -25 : 0);
const isIOS = Platform.OS === 'ios';

const styles = StyleSheet.create({
  background: {
    position: 'absolute',
    top: 0,
    left: 0
  },
  open: {
    position: 'absolute',
    flex: 1,
    justifyContent: 'center',
    // Android pan handlers crash without this declaration:
    backgroundColor: 'transparent',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'transparent',
  },
  closeButton: {
    fontSize: 35,
    color: 'white',
    lineHeight: 40,
    width: 40,
    textAlign: 'center',
    shadowOffset: {
      width: 0,
      height: 0,
    },
    shadowRadius: 1.5,
    shadowColor: 'black',
    shadowOpacity: 0.8,
  },
});

export default class LightboxOverlay extends Component {
  static propTypes = {
    origin: PropTypes.shape({
      x:        PropTypes.number,
      y:        PropTypes.number,
      width:    PropTypes.number,
      height:   PropTypes.number,
    }),
    springConfig: PropTypes.shape({
      tension:  PropTypes.number,
      friction: PropTypes.number,
    }),
    backgroundColor: PropTypes.string,
    isOpen:          PropTypes.bool,
    renderHeader:    PropTypes.func,
    onOpen:          PropTypes.func,
    onClose:         PropTypes.func,
    willClose:         PropTypes.func,
    swipeToDismiss:  PropTypes.bool,
    scalable: PropTypes.bool, // can be zoomed or not
  };

  static defaultProps = {
    springConfig: { tension: 30, friction: 7 },
    backgroundColor: 'black',
    scalable: true,
  };

  state = {
    isAnimating: false,
    isPanning: false,
    target: {
      x: 0,
      y: 0,
      opacity: 1,
    },
    pan: new Animated.Value(0),
    openVal: new Animated.Value(0),
    opacityVal: new Animated.Value(1),
    // for scalable
    scale: 1,
    lastScale: 1,
    offsetX: 0,
    offsetY: 0,
    lastX: 0,
    lastY: 0,
    window: Dimensions.get('window')
  };

  distant = 150;
  delay = 300;
  radius = 20;
  prevTouchInfo = {
    prevTouchX: 0,
    prevTouchY: 0,
    prevTouchTimeStamp: 0,
  };

  componentWillMount() {
    this._panResponder = PanResponder.create({
      // Ask to be the responder:
      onStartShouldSetPanResponder: (evt, gestureState) => {
        return !this.state.isAnimating;
      },
      onStartShouldSetPanResponderCapture: ({ nativeEvent: { touches } }, { vx, vy }) => {
        return Math.abs(vy) > Math.abs(vx) && !this.state.isAnimating
      },
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (this.state.isAnimating) {
          return false;
        } else {
          return this.props.scalable && gestureState.dx > 2 || gestureState.dy > 2 || gestureState.numberActiveTouches === 2;
        }
      },
      onMoveShouldSetPanResponderCapture: ({ nativeEvent: { touches } }, { vx, vy }) => {
        return Math.abs(vy) > Math.abs(vx) && !this.state.isAnimating
      },
      onPanResponderGrant: (evt, gestureState) => {
        const currentTouchTimeStamp = Date.now();
        this.state.pan.setValue(0);
        this.setState({
          isPanning: true,
        });
        if ( this.isDoubleTap(currentTouchTimeStamp, gestureState) ) {
          this.doubleTapZoom();
        }
        this.prevTouchInfo = {
          prevTouchX: gestureState.x0,
          prevTouchY: gestureState.y0,
          prevTouchTimeStamp: currentTouchTimeStamp,
        };
        if (gestureState.numberActiveTouches === 2) {
          this.distant = this.distance(evt.nativeEvent.touches[0].pageX, evt.nativeEvent.touches[0].pageY, evt.nativeEvent.touches[1].pageX, evt.nativeEvent.touches[1].pageY);
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        // zoom
        if (gestureState.numberActiveTouches === 2) {
          // let dx = Math.abs(evt.nativeEvent.touches[0].pageX - evt.nativeEvent.touches[1].pageX);
          // let dy = Math.abs(evt.nativeEvent.touches[0].pageY - evt.nativeEvent.touches[1].pageY);
          // let distant = Math.sqrt(dx * dx + dy * dy);

          let distant = this.distance(evt.nativeEvent.touches[0].pageX, evt.nativeEvent.touches[0].pageY, evt.nativeEvent.touches[1].pageX, evt.nativeEvent.touches[1].pageY);
          let scale = distant / this.distant * this.state.lastScale;
          this.setState({ scale });
        }
        // translate
        else if (gestureState.numberActiveTouches === 1 && this.state.scale > 1) {
          let offsetX = this.state.lastX + gestureState.dx / this.state.scale;
          let offsetY = this.state.lastY + gestureState.dy / this.state.scale;
          this.setState({ offsetX, offsetY });
        } else {
          this.state.pan.setValue(gestureState.dy);
        }
      },

      onPanResponderTerminationRequest: (evt, gestureState) => false,
      onPanResponderRelease: (evt, gestureState) => {
        if (this.state.scale > 1 ){
          this.setState({
            lastX: this.state.offsetX,
            lastY: this.state.offsetY,
            lastScale: this.state.scale
          });
        } else {
          this.resetOverlay();
          if(Math.abs(gestureState.dy) > DRAG_DISMISS_THRESHOLD) {
            this.setState({
              isPanning: false,
              target: {
                y: gestureState.dy,
                x: gestureState.dx,
                opacity: 1 - Math.abs(gestureState.dy / this.state.window.height)
              }
            });
            this.close();
          } else {
            Animated.spring(
              this.state.pan,
              { toValue: 0, ...this.props.springConfig }
            ).start(() => { this.setState({ isPanning: false }); });
          }
        }
      },
      onShouldBlockNativeResponder: evt => false,
    });
  }

  componentDidMount() {
    if(this.props.isOpen) {
      this.open();
    }

    Dimensions.addEventListener('change', this.onDimensionChange);
  }

  onDimensionChange = (event) => {
    this.setState({
      ...this.state,
      window: event.window
    });
  };

  componentWillUnmount() {
    Dimensions.removeEventListener('change', this.onDimensionChange);
  }

  // calculate distance between presses
  distance(x0, y0, x1, y1) {
    return Math.sqrt( Math.pow(( x1 - x0 ), 2) + Math.pow(( y1 - y0 ), 2) );
  }

  // is double tap or not
  isDoubleTap(currentTouchTimeStamp, {x0, y0}) {
    const { prevTouchX, prevTouchY, prevTouchTimeStamp } = this.prevTouchInfo;
    const dt = currentTouchTimeStamp - prevTouchTimeStamp;

    return ( dt < this.delay && this.distance(prevTouchX, prevTouchY, x0, y0) < this.radius );
  }

  doubleTapZoom(){
    if (this.state.scale !== 1) {
      this.resetOverlay();
    } else {
      this.setState({
        scale : 1.8,
        lastScale : 1.8,
      });
    }
  }

  // reset children
  resetOverlay(){
    this.setState({
      scale: 1,
      lastScale: 1,
      offsetX: 0,
      offsetY: 0,
      lastX: 0,
      lastY: 0
    });
  }

  open = () => {
    if(isIOS) {
      StatusBar.setHidden(true, 'fade');
    }
    this.state.pan.setValue(0);
    this.setState({
      isAnimating: true,
      target: {
        x: 0,
        y: 0,
        opacity: 1,
      }
    });

    Animated.spring(
      this.state.openVal,
      { toValue: 1, ...this.props.springConfig }
    ).start(() => {
      this.setState({ isAnimating: false });
      this.props.didOpen();
    });
    Animated.timing(this.state.opacityVal, { toValue: 1, duration: 0 }).start();
  }

  close = () => {
    this.props.willClose();
    if(isIOS) {
      StatusBar.setHidden(false, 'fade');
    }
    this.setState({
      isAnimating: true,
    });
    Animated.spring(
      this.state.openVal,
      { toValue: 0, ...this.props.springConfig }
    ).start(() => {
      this.setState({
        isAnimating: false,
      });
      this.props.onClose();
      // reset dispaly
      this.resetOverlay();
    });
    Animated.timing(this.state.opacityVal, { toValue: 0, duration: 150, easing: Easing.easeInBack }).start();
  }

  componentWillReceiveProps(props) {
    // reset dispaly also can been called here
    if(this.props.isOpen != props.isOpen && props.isOpen) {
      this.open();
    }
  }

  render() {
    const {
      isOpen,
      renderHeader,
      swipeToDismiss,
      scalable,
      origin,
      backgroundColor,
    } = this.props;

    const {
      isPanning,
      isAnimating,
      openVal,
      target,
      window
    } = this.state;

    const lightboxOpacityStyle = {
      opacity: openVal.interpolate({inputRange: [0, 1], outputRange: [0, target.opacity]})
    };

    let handlers;
    if(swipeToDismiss || scalable) {
      handlers = this._panResponder.panHandlers;
    }

    let dragStyle;
    if(isPanning) {
      dragStyle = {
        top: this.state.pan,
      };
      lightboxOpacityStyle.opacity = this.state.pan.interpolate({inputRange: [-window.height, 0, window.height], outputRange: [0, 1, 0]});
    }

    const openStyle = [styles.open, {
      left:   openVal.interpolate({inputRange: [0, 1], outputRange: [origin.x, target.x]}),
      top:    openVal.interpolate({inputRange: [0, 1], outputRange: [origin.y + STATUS_BAR_OFFSET, target.y + STATUS_BAR_OFFSET]}),
      width:  openVal.interpolate({inputRange: [0, 1], outputRange: [origin.width, window.width]}),
      height: openVal.interpolate({inputRange: [0, 1], outputRange: [origin.height, window.height]}),
    }];

    const opacity = {
      opacity: this.state.opacityVal.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
      })
    };

    const background = (<Animated.View style={[styles.background, { backgroundColor: backgroundColor, height: window.height, width: window.width }, lightboxOpacityStyle]}/>);
    const header = (<Animated.View style={[styles.header, lightboxOpacityStyle, {width: window.width}]}>{(renderHeader ?
      renderHeader(this.close) :
      (
        <TouchableOpacity onPress={this.close}>
          <Text style={styles.closeButton}>×</Text>
        </TouchableOpacity>
      )
    )}</Animated.View>);
    const content = (
      <Animated.View style={[openStyle, dragStyle, opacity, {
        transform: [
          {scaleX: this.state.scale},
          {scaleY: this.state.scale},
          {translateX: this.state.offsetX},
          {translateY: this.state.offsetY}
        ]
      }]} {...handlers}>
          {this.props.children}
      </Animated.View>
    );

    if (this.props.navigator) {
      return (
        <View>
          {background}
          {content}
          {header}
        </View>
      );
    }

    return (
      <Modal visible={isOpen} transparent={true} onRequestClose={() => this.close()}>
        {background}
        {content}
        {header}
      </Modal>
    );
  }
}
