# TODO: Auto-detect 3D with the following pseudocode
# Start cursor at 0xE
# Begin loop
#	Read two variable-length uInts (for up to 4 bytes, concatenate each group of 7 lowest-order bits until the highest-order bit is 0) and store them as "type" and "size"
#	Switch on "type":
#		0:
#			Skip ahead "size" bytes
#		2:
#			Skip ahead 6 bytes
#		4:
#			Skip ahead 2 bytes
#		1 or 3:
#			Skip ahead 2 bytes
#			Store the following uInt16BE's:
#				Frame rate numerator
#				Frame rate denominator
#				Width
#				Height
#			Skip ahead 2 bytes
#			Store the current byte as 3D format:
#				0: Interleave 3D, Left First
#				1: Interleave 3D, Right First
#				2: Top-To-Bottom 3D, Left First
#				3: Top-To-Bottom 3D, Right First
#				4: Side-By-Side3D, Left First
#				5: Side-By-Side3D, Right First
#				6: 2D
#			Break out of loop
# End loop
# References:
# https://code.ffmpeg.org/FFmpeg/FFmpeg/src/branch/release/4.4/libavformat/moflex.c
# https://github.com/Gericom/MobiclipDecoder/blob/c88b67d3cca93de03d286f67f01ee40da605f5ae/LibMobiclip/Containers/Moflex/MoLiveDemux.cs#L191
# https://github.com/Gericom/MobiclipDecoder/blob/c88b67d3cca93de03d286f67f01ee40da605f5ae/LibMobiclip/Containers/Moflex/MoLiveStreamVideoWithLayout.cs#L10
ffmpeg -i $1 -filter_complex "[0:v]select=mod(n+1\,2)[vl];[0:v]select=mod(n\,2)[vr];[vl][vr]hstack=2[stacked];[stacked]select=mod(n+1\,2)[selected];[selected]setsar=0.5[out]" -map "[out]:0" -map 0:a $1.3d.mp4
